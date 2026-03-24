package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

type SendMessageInput struct {
	FriendlyID      string              `json:"-"`
	Message         string              `json:"message"`
	Model           string              `json:"model"`
	Thinking        string              `json:"thinking"`
	Temperature     *float64            `json:"temperature"`
	TopP            *float64            `json:"topP"`
	MaxOutputTokens *int                `json:"maxOutputTokens"`
	IdempotencyKey  string              `json:"idempotencyKey"`
	Attachments     []AttachmentPayload `json:"attachments"`
}

type AttachmentPayload struct {
	MimeType string `json:"mimeType"`
	Content  string `json:"content"`
}

type SendMessageResult struct {
	RunID      string `json:"runId"`
	SessionKey string `json:"sessionKey"`
}

type ChatEvent struct {
	RunID      string         `json:"runId,omitempty"`
	SessionKey string         `json:"sessionKey,omitempty"`
	FriendlyID string         `json:"friendlyId,omitempty"`
	State      string         `json:"state,omitempty"`
	Message    map[string]any `json:"message,omitempty"`
}

type runRecord struct {
	ID        string
	UserID    string
	SessionID string
	Status    string
	Model     string
}

type RunBroker struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan ChatEvent]struct{}
}

func NewRunBroker() *RunBroker {
	return &RunBroker{
		subscribers: make(map[string]map[chan ChatEvent]struct{}),
	}
}

func (broker *RunBroker) Publish(sessionID string, event ChatEvent) {
	broker.mu.RLock()
	sessionSubscribers := broker.subscribers[sessionID]
	channels := make([]chan ChatEvent, 0, len(sessionSubscribers))
	for channel := range sessionSubscribers {
		channels = append(channels, channel)
	}
	broker.mu.RUnlock()

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
	broker.mu.Unlock()

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

type ChatRunService struct {
	db     *sql.DB
	chat   *ChatService
	broker *RunBroker
}

func NewChatRunService(db *sql.DB, chat *ChatService, broker *RunBroker) *ChatRunService {
	return &ChatRunService{
		db:     db,
		chat:   chat,
		broker: broker,
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

	userMessage, messageText, err := buildUserMessage(input.Message, input.Attachments)
	if err != nil {
		return SendMessageResult{}, err
	}

	now := time.Now().UnixMilli()
	userMessage["timestamp"] = now
	if _, err := service.chat.appendMessage(ctx, session, userMessage, now); err != nil {
		return SendMessageResult{}, err
	}

	runID := newID()
	model := normalizeModel(input.Model)
	if err := service.insertRun(ctx, runRecord{
		ID:        runID,
		UserID:    userID,
		SessionID: session.ID,
		Status:    "running",
		Model:     model,
	}, input, now); err != nil {
		return SendMessageResult{}, err
	}

	service.runAsync(runRecord{
		ID:        runID,
		UserID:    userID,
		SessionID: session.ID,
		Status:    "running",
		Model:     model,
	}, session, messageText, normalizeThinking(input.Thinking))

	return SendMessageResult{
		RunID:      runID,
		SessionKey: session.ID,
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
	userMessage string,
	thinking string,
) {
	go func() {
		ctx := context.Background()
		assistantMessageID := newID()
		answer := buildAssistantAnswer(userMessage)

		thinkingMessage := map[string]any{
			"id":               assistantMessageID,
			"role":             "assistant",
			"model":            record.Model,
			"modelName":        "Kairos Placeholder",
			"modelDescription": "Temporary server-side response until provider integrations land",
			"timestamp":        time.Now().UnixMilli(),
			"content": []map[string]any{
				{
					"type":     "thinking",
					"thinking": thinking,
				},
			},
		}

		service.broker.Publish(record.SessionID, ChatEvent{
			RunID:      record.ID,
			SessionKey: session.ID,
			FriendlyID: session.FriendlyID,
			State:      "delta",
			Message:    thinkingMessage,
		})

		chunks := chunkText(answer, 30)
		for index := range chunks {
			partialText := strings.Join(chunks[:index+1], "")
			time.Sleep(160 * time.Millisecond)
			service.broker.Publish(record.SessionID, ChatEvent{
				RunID:      record.ID,
				SessionKey: session.ID,
				FriendlyID: session.FriendlyID,
				State:      "delta",
				Message: map[string]any{
					"id":               assistantMessageID,
					"role":             "assistant",
					"model":            record.Model,
					"modelName":        "Kairos Placeholder",
					"modelDescription": "Temporary server-side response until provider integrations land",
					"timestamp":        time.Now().UnixMilli(),
					"content": []map[string]any{
						{
							"type":     "thinking",
							"thinking": thinking,
						},
						{
							"type": "text",
							"text": partialText,
						},
					},
				},
			})
		}

		finalTimestamp := time.Now().UnixMilli()
		finalMessage := map[string]any{
			"id":               assistantMessageID,
			"role":             "assistant",
			"model":            record.Model,
			"modelName":        "Kairos Placeholder",
			"modelDescription": "Temporary server-side response until provider integrations land",
			"timestamp":        finalTimestamp,
			"content": []map[string]any{
				{
					"type":     "thinking",
					"thinking": thinking,
				},
				{
					"type": "text",
					"text": answer,
				},
			},
		}

		if _, err := service.chat.appendMessage(ctx, session, finalMessage, finalTimestamp); err != nil {
			_ = service.markRunFailed(ctx, record.ID, err)
			service.broker.Publish(record.SessionID, ChatEvent{
				RunID:      record.ID,
				SessionKey: session.ID,
				FriendlyID: session.FriendlyID,
				State:      "error",
			})
			return
		}
		if err := service.markRunCompleted(ctx, record.ID, finalTimestamp); err != nil {
			service.broker.Publish(record.SessionID, ChatEvent{
				RunID:      record.ID,
				SessionKey: session.ID,
				FriendlyID: session.FriendlyID,
				State:      "error",
			})
			return
		}

		service.broker.Publish(record.SessionID, ChatEvent{
			RunID:      record.ID,
			SessionKey: session.ID,
			FriendlyID: session.FriendlyID,
			State:      "final",
			Message:    finalMessage,
		})
	}()
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

func buildAssistantAnswer(userMessage string) string {
	summary := summarizePrompt(userMessage)
	return `Here is a temporary Kairos backend reply based on "` + summary + `". ` +
		`This slice is focused on persistence and streaming, so the server now owns message history and refresh-safe chat state. ` +
		`Provider-backed generation will replace this placeholder in the next runtime slice.`
}

func summarizePrompt(value string) string {
	normalized := strings.Join(strings.Fields(value), " ")
	if normalized == "" {
		return "your latest message"
	}
	if len(normalized) <= 120 {
		return normalized
	}
	return strings.TrimSpace(normalized[:117]) + "..."
}

func normalizeModel(value string) string {
	if strings.TrimSpace(value) == "" {
		return "kairos-placeholder"
	}
	return strings.TrimSpace(value)
}

func normalizeThinking(value string) string {
	switch strings.TrimSpace(value) {
	case "high":
		return "Reviewing the request carefully before drafting a fuller answer."
	case "low":
		return "Preparing a concise reply."
	default:
		return "Planning a direct response."
	}
}

func chunkText(text string, chunkSize int) []string {
	if chunkSize <= 0 {
		chunkSize = 30
	}
	if text == "" {
		return []string{""}
	}
	chunks := make([]string, 0, (len(text)+chunkSize-1)/chunkSize)
	for index := 0; index < len(text); index += chunkSize {
		end := index + chunkSize
		if end > len(text) {
			end = len(text)
		}
		chunks = append(chunks, text[index:end])
	}
	return chunks
}
