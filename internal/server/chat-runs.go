package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
)

type SendMessageInput struct {
	FriendlyID     string              `json:"-"`
	Message        string              `json:"message"`
	Model          string              `json:"model"`
	IdempotencyKey string              `json:"idempotencyKey"`
	Attachments    []AttachmentPayload `json:"attachments"`
}

type AttachmentPayload struct {
	MimeType string `json:"mimeType"`
	Content  string `json:"content"`
}

type SendMessageResult struct {
	RunID              string `json:"runId"`
	SessionKey         string `json:"sessionKey"`
	AssistantMessageID string `json:"assistantMessageId"`
}

type ChatEvent struct {
	RunID      string         `json:"runId,omitempty"`
	SessionKey string         `json:"sessionKey,omitempty"`
	FriendlyID string         `json:"friendlyId,omitempty"`
	State      string         `json:"state,omitempty"`
	Error      string         `json:"error,omitempty"`
	Message    map[string]any `json:"message,omitempty"`
}

type runRecord struct {
	ID                 string
	UserID             string
	SessionID          string
	Status             string
	Model              string
	AssistantMessageID string
}

type RunBroker struct {
	mu           sync.RWMutex
	subscribers  map[string]map[chan ChatEvent]struct{}
	recentEvents map[string][]bufferedChatEvent
}

type bufferedChatEvent struct {
	event       ChatEvent
	publishedAt time.Time
}

const maxBufferedChatEvents = 12

const bufferedChatEventTTL = 30 * time.Second

func NewRunBroker() *RunBroker {
	return &RunBroker{
		subscribers:  make(map[string]map[chan ChatEvent]struct{}),
		recentEvents: make(map[string][]bufferedChatEvent),
	}
}

func (broker *RunBroker) Publish(sessionID string, event ChatEvent) {
	broker.mu.Lock()
	broker.recentEvents[sessionID] = broker.appendRecentEvent(
		broker.recentEvents[sessionID],
		event,
	)
	sessionSubscribers := broker.subscribers[sessionID]
	channels := make([]chan ChatEvent, 0, len(sessionSubscribers))
	for channel := range sessionSubscribers {
		channels = append(channels, channel)
	}
	broker.mu.Unlock()

	for _, channel := range channels {
		select {
		case channel <- event:
		default:
		}
	}
}

func (broker *RunBroker) Subscribe(sessionID string) (<-chan ChatEvent, func()) {
	channel := make(chan ChatEvent, 16)

	broker.mu.Lock()
	if broker.subscribers[sessionID] == nil {
		broker.subscribers[sessionID] = make(map[chan ChatEvent]struct{})
	}
	broker.subscribers[sessionID][channel] = struct{}{}
	recentEvents := broker.pruneRecentEvents(broker.recentEvents[sessionID])
	if len(recentEvents) == 0 {
		delete(broker.recentEvents, sessionID)
	} else {
		broker.recentEvents[sessionID] = recentEvents
	}
	broker.mu.Unlock()

	for _, recentEvent := range recentEvents {
		select {
		case channel <- recentEvent.event:
		default:
		}
	}

	return channel, func() {
		broker.mu.Lock()
		if sessionSubscribers := broker.subscribers[sessionID]; sessionSubscribers != nil {
			delete(sessionSubscribers, channel)
			if len(sessionSubscribers) == 0 {
				delete(broker.subscribers, sessionID)
			}
		}
		broker.mu.Unlock()
		close(channel)
	}
}

func (broker *RunBroker) appendRecentEvent(
	recentEvents []bufferedChatEvent,
	event ChatEvent,
) []bufferedChatEvent {
	pruned := broker.pruneRecentEvents(recentEvents)
	pruned = append(pruned, bufferedChatEvent{
		event:       event,
		publishedAt: time.Now(),
	})
	if len(pruned) > maxBufferedChatEvents {
		pruned = pruned[len(pruned)-maxBufferedChatEvents:]
	}
	return pruned
}

func (broker *RunBroker) pruneRecentEvents(
	recentEvents []bufferedChatEvent,
) []bufferedChatEvent {
	if len(recentEvents) == 0 {
		return nil
	}
	cutoff := time.Now().Add(-bufferedChatEventTTL)
	pruned := recentEvents[:0]
	for _, recentEvent := range recentEvents {
		if recentEvent.publishedAt.Before(cutoff) {
			continue
		}
		pruned = append(pruned, recentEvent)
	}
	return pruned
}

type ChatRunService struct {
	db          *sql.DB
	chat        *ChatService
	providers   *ProviderService
	broker      *RunBroker
	runMu       sync.Mutex
	runCancels  map[string]context.CancelFunc
	sessionRuns map[string]map[string]struct{}
}

func NewChatRunService(
	db *sql.DB,
	chat *ChatService,
	providers *ProviderService,
	broker *RunBroker,
) *ChatRunService {
	return &ChatRunService{
		db:          db,
		chat:        chat,
		providers:   providers,
		broker:      broker,
		runCancels:  make(map[string]context.CancelFunc),
		sessionRuns: make(map[string]map[string]struct{}),
	}
}

func (service *ChatRunService) StartRun(
	ctx context.Context,
	userID string,
	input SendMessageInput,
) (SendMessageResult, error) {
	session, err := service.chat.findSessionByFriendlyID(ctx, userID, input.FriendlyID)
	if err != nil {
		return SendMessageResult{}, err
	}

	userMessage, _, err := buildUserMessage(input.Message, input.Attachments)
	if err != nil {
		return SendMessageResult{}, err
	}

	now := time.Now().UnixMilli()
	userMessage["timestamp"] = now
	if _, err := service.chat.appendMessage(ctx, session, userMessage, now); err != nil {
		return SendMessageResult{}, err
	}

	runID := newID()
	assistantMessageID := newID()
	model := normalizeModel(input.Model)
	if err := service.insertRun(ctx, runRecord{
		ID:                 runID,
		UserID:             userID,
		SessionID:          session.ID,
		Status:             "running",
		Model:              model,
		AssistantMessageID: assistantMessageID,
	}, input, now); err != nil {
		return SendMessageResult{}, err
	}

	history, err := service.chat.GetHistory(ctx, userID, input.FriendlyID)
	if err != nil {
		return SendMessageResult{}, err
	}

	service.runAsync(runRecord{
		ID:                 runID,
		UserID:             userID,
		SessionID:          session.ID,
		Status:             "running",
		Model:              model,
		AssistantMessageID: assistantMessageID,
	}, session, history.Messages, input)

	return SendMessageResult{
		RunID:              runID,
		SessionKey:         session.ID,
		AssistantMessageID: assistantMessageID,
	}, nil
}

func (service *ChatRunService) StreamSession(
	ctx context.Context,
	userID string,
	friendlyID string,
	onEvent func(ChatEvent) error,
) error {
	session, err := service.chat.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return err
	}

	channel, unsubscribe := service.broker.Subscribe(session.ID)
	defer unsubscribe()

	for {
		select {
		case <-ctx.Done():
			return nil
		case event, ok := <-channel:
			if !ok {
				return nil
			}
			if err := onEvent(event); err != nil {
				return err
			}
		}
	}
}

func (service *ChatRunService) ResolveSession(
	ctx context.Context,
	userID string,
	friendlyID string,
) (sessionRecord, error) {
	return service.chat.findSessionByFriendlyID(ctx, userID, friendlyID)
}

func (service *ChatRunService) CancelSessionRuns(
	ctx context.Context,
	userID string,
	friendlyID string,
) (bool, error) {
	session, err := service.chat.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return false, err
	}

	service.runMu.Lock()
	runIDs := service.sessionRuns[session.ID]
	if len(runIDs) == 0 {
		service.runMu.Unlock()
		return false, nil
	}

	cancels := make([]context.CancelFunc, 0, len(runIDs))
	for runID := range runIDs {
		cancel := service.runCancels[runID]
		if cancel != nil {
			cancels = append(cancels, cancel)
		}
	}
	service.runMu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}

	return len(cancels) > 0, nil
}

func (service *ChatRunService) insertRun(
	ctx context.Context,
	record runRecord,
	input SendMessageInput,
	now int64,
) error {
	requestJSON, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("encode run request: %w", err)
	}

	if _, err := service.db.ExecContext(ctx, `
		INSERT INTO chat_runs(
			id,
			user_id,
			session_id,
			status,
			model,
			request_json,
			started_at,
			created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, record.ID, record.UserID, record.SessionID, record.Status, record.Model, string(requestJSON), now, now); err != nil {
		return fmt.Errorf("insert run: %w", err)
	}

	return nil
}

func (service *ChatRunService) runAsync(
	record runRecord,
	session sessionRecord,
	history []map[string]any,
	input SendMessageInput,
) {
	ctx, cancel := context.WithCancel(context.Background())
	service.registerRunCancel(record, cancel)
	go func() {
		defer service.unregisterRunCancel(record)
		service.executeRun(ctx, record, session, history, input)
	}()
}

func (service *ChatRunService) executeRun(
	ctx context.Context,
	record runRecord,
	session sessionRecord,
	history []map[string]any,
	input SendMessageInput,
) {
	provider, model, _, err := service.providers.ResolveGenerationTarget(ctx, record.UserID, record.Model)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			service.publishRunAborted(ctx, record, session, nil)
			return
		}
		service.publishRunError(ctx, record, session, err)
		return
	}
	if model.ContextWindow > 0 {
		if err := service.chat.UpdateSessionContextTokens(ctx, session.ID, session.UserID, model.ContextWindow); err == nil {
			session.ContextTokens = model.ContextWindow
		}
	}

	driver := service.providers.drivers[provider.Record.Kind]
	if driver == nil {
		service.publishRunError(
			ctx,
			record,
			session,
			fmt.Errorf("unsupported provider kind: %s", provider.Record.Kind),
		)
		return
	}

	accumulatedText := ""
	accumulatedThinking := ""
	modelID := model.ID
	modelName := firstNonEmpty(model.Name, model.ID)
	modelDescription := provider.Record.Label
	minAssistantTimestamp := latestMessageTimestamp(history) + 1
	result, err := driver.GenerateChatStream(
		ctx,
		provider,
		ChatGenerationRequest{
			Model:    model.ID,
			Messages: buildProviderMessages(history),
		},
		func(delta ChatGenerationDelta) error {
			if delta.Thinking != "" {
				accumulatedThinking += delta.Thinking
			}
			if delta.Text != "" {
				accumulatedText += delta.Text
			}
			content := buildAssistantContent(accumulatedThinking, accumulatedText)
			if len(content) == 0 {
				return nil
			}
			service.broker.Publish(
				record.SessionID,
				buildRunEvent(
					record,
					session,
					"delta",
					"",
					buildAssistantMessage(
						record.AssistantMessageID,
						modelID,
						modelName,
						modelDescription,
						time.Now().UnixMilli(),
						content,
					),
				),
			)
			return nil
		},
	)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			abortedTimestamp := maxInt64(time.Now().UnixMilli(), minAssistantTimestamp)
			abortedMessage := buildAssistantMessage(
				record.AssistantMessageID,
				modelID,
				modelName,
				modelDescription,
				abortedTimestamp,
				buildAssistantContent(accumulatedThinking, accumulatedText),
			)
			service.publishRunAborted(ctx, record, session, abortedMessage)
			return
		}
		service.publishRunError(ctx, record, session, err)
		return
	}
	modelID = firstNonEmpty(result.Model, modelID)
	modelName = firstNonEmpty(result.ModelName, modelName)
	modelDescription = firstNonEmpty(result.ModelDescription, modelDescription)
	accumulatedThinking = firstNonEmpty(result.ThinkingText, accumulatedThinking)

	finalTimestamp := maxInt64(time.Now().UnixMilli(), minAssistantTimestamp)
	finalMessage := buildAssistantMessage(
		record.AssistantMessageID,
		modelID,
		modelName,
		modelDescription,
		finalTimestamp,
		buildAssistantContent(accumulatedThinking, result.OutputText),
	)
	if usageDetails := buildUsageDetails(result); usageDetails != nil {
		finalMessage["details"] = map[string]any{
			"usage": usageDetails,
		}
	}

	if _, err := service.chat.appendMessage(ctx, session, finalMessage, finalTimestamp); err != nil {
		service.publishRunError(ctx, record, session, err)
		return
	}
	if result.TotalTokens > 0 {
		if err := service.chat.UpdateSessionTotalTokens(ctx, session.ID, session.UserID, result.TotalTokens); err != nil {
			service.publishRunError(ctx, record, session, err)
			return
		}
		session.TotalTokens = result.TotalTokens
	}
	if err := service.markRunCompleted(ctx, record.ID, finalTimestamp); err != nil {
		service.publishRunError(ctx, record, session, err)
		return
	}

	service.broker.Publish(
		record.SessionID,
		buildRunEvent(record, session, "final", "", finalMessage),
	)
}

func (service *ChatRunService) publishRunError(
	ctx context.Context,
	record runRecord,
	session sessionRecord,
	runErr error,
) {
	normalizedError := strings.TrimSpace(runErr.Error())
	if normalizedError == "" {
		normalizedError = "run failed"
	}
	if err := service.markRunFailed(ctx, record.ID, runErr); err != nil {
		log.Printf("kairos: failed to persist run error for run %s: %v", record.ID, err)
	}
	log.Printf(
		"kairos: run %s failed for session %s (%s): %s",
		record.ID,
		session.ID,
		session.FriendlyID,
		normalizedError,
	)
	service.broker.Publish(
		record.SessionID,
		buildRunEvent(record, session, "error", normalizedError, nil),
	)
}

func (service *ChatRunService) publishRunAborted(
	ctx context.Context,
	record runRecord,
	session sessionRecord,
	message map[string]any,
) {
	persistCtx := context.Background()
	if len(message) > 0 {
		timestamp, _ := message["timestamp"].(int64)
		if timestamp == 0 {
			timestamp = time.Now().UnixMilli()
			message["timestamp"] = timestamp
		}
		if _, err := service.chat.appendMessage(persistCtx, session, message, timestamp); err != nil {
			log.Printf("kairos: failed to persist aborted run message for run %s: %v", record.ID, err)
		}
	}
	if err := service.markRunAborted(persistCtx, record.ID); err != nil {
		log.Printf("kairos: failed to persist run abort for run %s: %v", record.ID, err)
	}
	service.broker.Publish(
		record.SessionID,
		buildRunEvent(record, session, "aborted", "", message),
	)
}

func (service *ChatRunService) markRunCompleted(ctx context.Context, runID string, completedAt int64) error {
	if _, err := service.db.ExecContext(ctx, `
		UPDATE chat_runs
		SET status = 'completed', completed_at = ?, error_message = NULL
		WHERE id = ?
	`, completedAt, runID); err != nil {
		return fmt.Errorf("complete run: %w", err)
	}
	return nil
}

func (service *ChatRunService) markRunFailed(ctx context.Context, runID string, runErr error) error {
	if _, err := service.db.ExecContext(ctx, `
		UPDATE chat_runs
		SET status = 'error', completed_at = ?, error_message = ?
		WHERE id = ?
	`, time.Now().UnixMilli(), strings.TrimSpace(runErr.Error()), runID); err != nil {
		return fmt.Errorf("fail run: %w", err)
	}
	return nil
}

func (service *ChatRunService) markRunAborted(ctx context.Context, runID string) error {
	if _, err := service.db.ExecContext(ctx, `
		UPDATE chat_runs
		SET status = 'aborted', completed_at = ?, error_message = NULL
		WHERE id = ?
	`, time.Now().UnixMilli(), runID); err != nil {
		return fmt.Errorf("abort run: %w", err)
	}
	return nil
}

func (service *ChatRunService) registerRunCancel(
	record runRecord,
	cancel context.CancelFunc,
) {
	service.runMu.Lock()
	defer service.runMu.Unlock()
	service.runCancels[record.ID] = cancel
	if service.sessionRuns[record.SessionID] == nil {
		service.sessionRuns[record.SessionID] = make(map[string]struct{})
	}
	service.sessionRuns[record.SessionID][record.ID] = struct{}{}
}

func (service *ChatRunService) unregisterRunCancel(record runRecord) {
	service.runMu.Lock()
	defer service.runMu.Unlock()
	delete(service.runCancels, record.ID)
	sessionRuns := service.sessionRuns[record.SessionID]
	if sessionRuns == nil {
		return
	}
	delete(sessionRuns, record.ID)
	if len(sessionRuns) == 0 {
		delete(service.sessionRuns, record.SessionID)
	}
}

func buildUserMessage(
	message string,
	attachments []AttachmentPayload,
) (map[string]any, string, error) {
	normalizedMessage := strings.TrimSpace(message)
	if normalizedMessage == "" && len(attachments) == 0 {
		return nil, "", fmt.Errorf("message must not be empty")
	}

	content := make([]map[string]any, 0, len(attachments)+1)
	for _, attachment := range attachments {
		if strings.TrimSpace(attachment.MimeType) == "" || strings.TrimSpace(attachment.Content) == "" {
			continue
		}
		content = append(content, map[string]any{
			"type": "image",
			"source": map[string]any{
				"type":       "base64",
				"media_type": strings.TrimSpace(attachment.MimeType),
				"data":       strings.TrimSpace(attachment.Content),
			},
		})
	}
	if normalizedMessage != "" {
		content = append(content, map[string]any{
			"type": "text",
			"text": normalizedMessage,
		})
	}

	return map[string]any{
		"id":      newID(),
		"role":    "user",
		"content": content,
	}, normalizedMessage, nil
}

func normalizeModel(value string) string {
	return strings.TrimSpace(value)
}

func buildAssistantContent(thinking string, text string) []map[string]any {
	content := make([]map[string]any, 0, 2)
	if normalizedThinking := strings.TrimSpace(thinking); normalizedThinking != "" {
		content = append(content, map[string]any{
			"type":     "thinking",
			"thinking": normalizedThinking,
		})
	}
	if normalizedText := strings.TrimSpace(text); normalizedText != "" {
		content = append(content, map[string]any{
			"type": "text",
			"text": normalizedText,
		})
	}
	return content
}

func buildAssistantMessage(
	messageID string,
	modelID string,
	modelName string,
	modelDescription string,
	timestamp int64,
	content []map[string]any,
) map[string]any {
	return map[string]any{
		"id":               messageID,
		"role":             "assistant",
		"model":            modelID,
		"modelName":        modelName,
		"modelDescription": modelDescription,
		"timestamp":        timestamp,
		"content":          content,
	}
}

func buildUsageDetails(result ChatGenerationResult) map[string]any {
	if result.PromptTokens <= 0 && result.CompletionTokens <= 0 && result.TotalTokens <= 0 {
		return nil
	}

	return map[string]any{
		"promptTokens":     result.PromptTokens,
		"completionTokens": result.CompletionTokens,
		"totalTokens":      result.TotalTokens,
	}
}

func buildRunEvent(
	record runRecord,
	session sessionRecord,
	state string,
	errorMessage string,
	message map[string]any,
) ChatEvent {
	return ChatEvent{
		RunID:      record.ID,
		SessionKey: session.ID,
		FriendlyID: session.FriendlyID,
		State:      state,
		Error:      errorMessage,
		Message:    message,
	}
}

func buildProviderMessages(history []map[string]any) []ProviderMessage {
	messages := make([]ProviderMessage, 0, len(history))
	for _, message := range history {
		role := strings.TrimSpace(stringValueFromMap(message, "role"))
		if role == "" {
			continue
		}
		parts := extractProviderMessageParts(message["content"])
		if len(parts) == 0 {
			continue
		}
		messages = append(messages, ProviderMessage{
			Role:  role,
			Parts: parts,
		})
	}
	return messages
}

func extractProviderMessageParts(value any) []ProviderMessagePart {
	items, ok := value.([]any)
	if !ok {
		return nil
	}

	parts := make([]ProviderMessagePart, 0, len(items))
	for _, item := range items {
		part, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch strings.TrimSpace(stringValueFromMap(part, "type")) {
		case "text":
			if text := strings.TrimSpace(stringValueFromMap(part, "text")); text != "" {
				parts = append(parts, ProviderMessagePart{
					Type: "text",
					Text: text,
				})
			}
		case "image":
			source, ok := part["source"].(map[string]any)
			if !ok {
				continue
			}
			if strings.TrimSpace(stringValueFromMap(source, "type")) != "base64" {
				continue
			}
			mimeType := strings.TrimSpace(stringValueFromMap(source, "media_type"))
			content := strings.TrimSpace(stringValueFromMap(source, "data"))
			if mimeType == "" || content == "" {
				continue
			}
			parts = append(parts, ProviderMessagePart{
				Type:     "image",
				MimeType: mimeType,
				Content:  content,
			})
		}
	}
	return parts
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func latestMessageTimestamp(messages []map[string]any) int64 {
	var latest int64
	for _, message := range messages {
		timestamp := int64Value(message["timestamp"])
		if timestamp > latest {
			latest = timestamp
		}
	}
	return latest
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func int64Value(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return parsed
		}
	}
	return 0
}
