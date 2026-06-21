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
	FriendlyID     string               `json:"-"`
	Message        string               `json:"message"`
	Model          string               `json:"model"`
	SystemPrompt   string               `json:"systemPrompt"`
	WebSearch      bool                 `json:"webSearch"`
	MathTools      bool                 `json:"mathTools"`
	Advanced       *ChatAdvancedOptions `json:"advanced"`
	IdempotencyKey string               `json:"idempotencyKey"`
	ClientID       string               `json:"clientId"`
	Attachments    []AttachmentPayload  `json:"attachments"`
}

type AttachmentPayload struct {
	MimeType string `json:"mimeType"`
	Content  string `json:"content"`
}

type SendMessageResult struct {
	RunID              string `json:"runId"`
	SessionKey         string `json:"sessionKey"`
	UserMessageID      string `json:"userMessageId"`
	AssistantMessageID string `json:"assistantMessageId"`
	ClientID           string `json:"clientId,omitempty"`
}

type runRecord struct {
	ID                 string
	UserID             string
	SessionID          string
	Status             string
	Model              string
	IdempotencyKey     string
	AssistantMessageID string
}

type ChatRunService struct {
	db          *sql.DB
	chat        *ChatService
	providers   *ProviderService
	webSettings *WebToolSettingsService
	broker      *RunBroker
	runMu       sync.Mutex
	runCancels  map[string]context.CancelFunc
	sessionRuns map[string]map[string]struct{}
}

func NewChatRunService(
	db *sql.DB,
	chat *ChatService,
	providers *ProviderService,
	webSettings *WebToolSettingsService,
	broker *RunBroker,
) *ChatRunService {
	return &ChatRunService{
		db:          db,
		chat:        chat,
		providers:   providers,
		webSettings: webSettings,
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
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if idempotencyKey != "" {
		existingRun, found, err := service.findRunByIdempotencyKey(
			ctx,
			userID,
			session.ID,
			idempotencyKey,
		)
		if err != nil {
			return SendMessageResult{}, err
		}
		if found {
			return SendMessageResult{
				RunID:              existingRun.ID,
				SessionKey:         session.ID,
				AssistantMessageID: existingRun.AssistantMessageID,
				ClientID:           strings.TrimSpace(input.ClientID),
			}, nil
		}
	}
	shouldGenerateTitle := shouldAutoGenerateSessionTitle(session)
	titlePreferences := UserPreferences{}
	autoGenerateTitleEnabled := false
	if shouldGenerateTitle {
		preferences, preferencesErr := service.providers.GetPreferences(ctx, session.UserID)
		if preferencesErr == nil {
			titlePreferences = preferences
			autoGenerateTitleEnabled = preferences.AutoGenerateTitle
		} else {
			log.Printf(
				"kairos: failed to load title preferences for session %s (%s): %v",
				session.ID,
				session.FriendlyID,
				preferencesErr,
			)
		}
	}

	userMessage, _, err := buildUserMessage(input.Message, input.Attachments, input.ClientID)
	if err != nil {
		return SendMessageResult{}, err
	}

	now := time.Now().UnixMilli()
	userMessage["timestamp"] = now
	runID := newID()
	assistantMessageID := newID()
	model := normalizeModel(input.Model)
	record := runRecord{
		ID:                 runID,
		UserID:             userID,
		SessionID:          session.ID,
		Status:             "running",
		Model:              model,
		IdempotencyKey:     idempotencyKey,
		AssistantMessageID: assistantMessageID,
	}

	transaction, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return SendMessageResult{}, fmt.Errorf("begin run tx: %w", err)
	}
	defer transaction.Rollback()

	if _, err := service.chat.appendMessageWithOptionsExec(
		ctx,
		transaction,
		session,
		userMessage,
		now,
		appendMessageOptions{
			SkipDerivedTitle: shouldGenerateTitle && autoGenerateTitleEnabled,
		},
	); err != nil {
		return SendMessageResult{}, err
	}

	if err := service.insertRunExec(ctx, transaction, record, input, now); err != nil {
		if idempotencyKey != "" && isUniqueConstraintError(err) {
			_ = transaction.Rollback()
			existingRun, found, lookupErr := service.findRunByIdempotencyKey(
				ctx,
				userID,
				session.ID,
				idempotencyKey,
			)
			if lookupErr != nil {
				return SendMessageResult{}, lookupErr
			}
			if found {
				return SendMessageResult{
					RunID:              existingRun.ID,
					SessionKey:         session.ID,
					AssistantMessageID: existingRun.AssistantMessageID,
					ClientID:           strings.TrimSpace(input.ClientID),
				}, nil
			}
		}
		return SendMessageResult{}, err
	}
	if err := transaction.Commit(); err != nil {
		return SendMessageResult{}, fmt.Errorf("commit run tx: %w", err)
	}

	history, err := service.chat.GetHistory(ctx, userID, input.FriendlyID)
	if err != nil {
		return SendMessageResult{}, err
	}

	if shouldGenerateTitle && autoGenerateTitleEnabled {
		service.maybeGenerateSessionTitle(session, input, userMessage, titlePreferences)
	}

	service.runAsync(record, session, history.Messages, input)

	return SendMessageResult{
		RunID:              runID,
		SessionKey:         session.ID,
		UserMessageID:      stringValueFromMap(userMessage, "id"),
		AssistantMessageID: assistantMessageID,
		ClientID:           strings.TrimSpace(input.ClientID),
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
	return service.insertRunExec(ctx, service.db, record, input, now)
}

func (service *ChatRunService) insertRunExec(
	ctx context.Context,
	exec sqlExecutor,
	record runRecord,
	input SendMessageInput,
	now int64,
) error {
	requestJSON, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("encode run request: %w", err)
	}

	if _, err := exec.ExecContext(ctx, `
		INSERT INTO chat_runs(
			id,
			user_id,
			session_id,
			status,
			model,
			idempotency_key,
			assistant_message_id,
			request_json,
			started_at,
			created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, record.ID, record.UserID, record.SessionID, record.Status, record.Model, nullableString(record.IdempotencyKey), nullableString(record.AssistantMessageID), string(requestJSON), now, now); err != nil {
		return fmt.Errorf("insert run: %w", err)
	}

	return nil
}

func (service *ChatRunService) findRunByIdempotencyKey(
	ctx context.Context,
	userID string,
	sessionID string,
	idempotencyKey string,
) (runRecord, bool, error) {
	normalizedKey := strings.TrimSpace(idempotencyKey)
	if normalizedKey == "" {
		return runRecord{}, false, nil
	}

	var record runRecord
	var assistantMessageID sql.NullString
	err := service.db.QueryRowContext(ctx, `
		SELECT id, user_id, session_id, status, model, assistant_message_id
		FROM chat_runs
		WHERE user_id = ? AND session_id = ? AND idempotency_key = ?
		LIMIT 1
	`, userID, sessionID, normalizedKey).Scan(
		&record.ID,
		&record.UserID,
		&record.SessionID,
		&record.Status,
		&record.Model,
		&assistantMessageID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return runRecord{}, false, nil
	}
	if err != nil {
		return runRecord{}, false, fmt.Errorf("find idempotent run: %w", err)
	}
	record.IdempotencyKey = normalizedKey
	record.AssistantMessageID = nullStringValue(assistantMessageID)
	return record, true, nil
}

func isUniqueConstraintError(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}
