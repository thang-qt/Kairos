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

type SubmitTurnInput struct {
	EditMessageID    string               `json:"-"`
	ExpectedRevision *int64               `json:"expectedRevision,omitempty"`
	FriendlyID       string               `json:"-"`
	Message          string               `json:"message"`
	Model            string               `json:"model"`
	SystemPrompt     string               `json:"systemPrompt"`
	WebSearch        bool                 `json:"webSearch"`
	MathTools        bool                 `json:"mathTools"`
	Advanced         *ChatAdvancedOptions `json:"advanced"`
	IdempotencyKey   string               `json:"idempotencyKey"`
	ClientID         string               `json:"clientId"`
	ClientTime       string               `json:"clientTime"`
	ClientTimeZone   string               `json:"clientTimeZone"`
	Attachments      []AttachmentPayload  `json:"attachments"`
}

type AttachmentPayload struct {
	MimeType string `json:"mimeType"`
	Content  string `json:"content"`
}

type SubmitTurnResult struct {
	RunID           string `json:"runId"`
	SessionKey      string `json:"sessionKey"`
	UserTurnID      string `json:"userTurnId"`
	AssistantTurnID string `json:"assistantTurnId"`
	ClientID        string `json:"clientId,omitempty"`
}

type executionRecord struct {
	UserTurnID      string
	AcceptedAt      int64
	TurnTimestamp   int64
	Revision        int64
	LeaseToken      string
	ID              string
	UserID          string
	SessionID       string
	Status          string
	Model           string
	IdempotencyKey  string
	AssistantTurnID string
}

type toolExecutor interface {
	Execute(ctx context.Context, call ProviderToolCall) (WebToolResult, error)
}

type AgentRuntime struct {
	workerOnce    sync.Once
	workerCancel  context.CancelFunc
	workerContext context.Context
	workerWG      sync.WaitGroup
	wake          chan struct{}
	db            *sql.DB
	chat          *ConversationService
	providers     *ProviderService
	webSettings   *WebToolSettingsService
	toolRuntime   func(ctx context.Context, userID string, input SubmitTurnInput) (toolExecutor, error)
	runMu         sync.Mutex
	runCancels    map[string]context.CancelFunc
	sessionRuns   map[string]map[string]struct{}
}

func NewAgentRuntime(
	db *sql.DB,
	chat *ConversationService,
	providers *ProviderService,
	webSettings *WebToolSettingsService,
) *AgentRuntime {
	service := &AgentRuntime{
		wake:        make(chan struct{}, 1),
		db:          db,
		chat:        chat,
		providers:   providers,
		webSettings: webSettings,
		runCancels:  make(map[string]context.CancelFunc),
		sessionRuns: make(map[string]map[string]struct{}),
	}
	service.toolRuntime = service.defaultToolRuntime
	return service
}

func (service *AgentRuntime) defaultToolRuntime(
	ctx context.Context,
	userID string,
	input SubmitTurnInput,
) (toolExecutor, error) {
	runtime := NewWebToolRuntimeFromEnv()
	if input.WebSearch && service.webSettings != nil {
		resolvedRuntime, err := service.webSettings.ResolveRuntime(ctx, userID)
		if err != nil {
			return nil, err
		}
		runtime = resolvedRuntime
	}
	return runtime, nil
}

func (service *AgentRuntime) StartRun(
	ctx context.Context,
	userID string,
	input SubmitTurnInput,
) (SubmitTurnResult, error) {
	service.chat.commandMu.Lock()
	defer service.chat.commandMu.Unlock()
	session, err := service.chat.findSessionByFriendlyID(ctx, userID, input.FriendlyID)
	if err != nil {
		return SubmitTurnResult{}, err
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
			return SubmitTurnResult{}, err
		}
		if found {
			return SubmitTurnResult{
				RunID:           existingRun.ID,
				SessionKey:      session.ID,
				AssistantTurnID: existingRun.AssistantTurnID,
				UserTurnID:      existingRun.UserTurnID,
				ClientID:        strings.TrimSpace(input.ClientID),
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
		return SubmitTurnResult{}, err
	}

	now := time.Now().UnixMilli()
	userMessage["timestamp"] = now
	runID := newID()
	assistantMessageID := newID()
	model := normalizeModel(input.Model)
	record := executionRecord{
		ID:              runID,
		UserID:          userID,
		SessionID:       session.ID,
		Status:          "queued",
		AcceptedAt:      now,
		Model:           model,
		IdempotencyKey:  idempotencyKey,
		AssistantTurnID: assistantMessageID,
	}

	transaction, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return SubmitTurnResult{}, fmt.Errorf("begin run tx: %w", err)
	}
	defer transaction.Rollback()

	if err := transaction.QueryRowContext(ctx, `SELECT revision FROM chat_sessions WHERE id=?`, session.ID).Scan(&record.Revision); err != nil {
		return SubmitTurnResult{}, err
	}
	if input.ExpectedRevision != nil && *input.ExpectedRevision != record.Revision {
		return SubmitTurnResult{}, errConversationConflict
	}
	if input.EditMessageID != "" {
		records, err := service.chat.listMessageRecordsExec(ctx, transaction, session.ID)
		if err != nil {
			return SubmitTurnResult{}, err
		}
		index := findMessageRecordIndex(records, input.EditMessageID)
		if index < 0 || records[index].Role != "user" {
			return SubmitTurnResult{}, errConversationConflict
		}
		input.Attachments = extractAttachmentPayloads(records[index].Message)
		userMessage, _, err = buildUserMessage(input.Message, input.Attachments, input.ClientID)
		if err != nil {
			return SubmitTurnResult{}, err
		}
		userMessage["id"] = input.EditMessageID
		userMessage["timestamp"] = now
		if err := service.chat.truncateSessionMessagesExec(ctx, transaction, &session, records, index); err != nil {
			return SubmitTurnResult{}, err
		}
		record.Revision++
	}
	var active int
	if err := transaction.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_runs WHERE session_id=? AND status IN ('queued','preparing','running')`, session.ID).Scan(&active); err != nil {
		return SubmitTurnResult{}, err
	}
	if active > 0 {
		return SubmitTurnResult{}, errConversationConflict
	}

	var latestTimestamp int64
	if err := transaction.QueryRowContext(ctx, `SELECT MAX(COALESCE((SELECT MAX(timestamp) FROM chat_messages WHERE session_id=?),0),COALESCE((SELECT MAX(started_at) FROM chat_runs WHERE session_id=? AND invalidated=0),0))`, session.ID, session.ID).Scan(&latestTimestamp); err != nil {
		return SubmitTurnResult{}, err
	}
	userTimestamp := maxInt64(now, latestTimestamp+1)
	userMessage["timestamp"] = userTimestamp
	record.TurnTimestamp = userTimestamp + 1
	if _, err := service.chat.appendMessageWithOptionsExec(
		ctx,
		transaction,
		session,
		userMessage,
		userTimestamp,
		appendMessageOptions{
			SkipDerivedTitle: shouldGenerateTitle && autoGenerateTitleEnabled,
		},
	); err != nil {
		return SubmitTurnResult{}, err
	}

	if err := insertChatEventExec(ctx, transaction, ConversationEvent{SessionKey: session.ID, Revision: record.Revision, TurnID: messageIDFromMap(userMessage), RunID: record.ID, State: "user", Message: userMessage}); err != nil {
		return SubmitTurnResult{}, err
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
				return SubmitTurnResult{}, lookupErr
			}
			if found {
				return SubmitTurnResult{
					RunID:           existingRun.ID,
					SessionKey:      session.ID,
					AssistantTurnID: existingRun.AssistantTurnID,
					UserTurnID:      existingRun.UserTurnID,
					ClientID:        strings.TrimSpace(input.ClientID),
				}, nil
			}
		}
		return SubmitTurnResult{}, err
	}
	if _, err := transaction.ExecContext(ctx, `UPDATE chat_runs SET user_message_id=? WHERE id=?`, messageIDFromMap(userMessage), record.ID); err != nil {
		return SubmitTurnResult{}, err
	}
	if err := transaction.Commit(); err != nil {
		return SubmitTurnResult{}, fmt.Errorf("commit run tx: %w", err)
	}

	service.StartWorkers()
	if shouldGenerateTitle && autoGenerateTitleEnabled {
		service.maybeGenerateSessionTitle(session, input, userMessage, titlePreferences)
	}
	service.notifyQueue()
	log.Printf("kairos: stage=accepted run=%s revision=%d", record.ID, record.Revision)

	return SubmitTurnResult{
		RunID:           runID,
		SessionKey:      session.ID,
		UserTurnID:      stringValueFromMap(userMessage, "id"),
		AssistantTurnID: assistantMessageID,
		ClientID:        strings.TrimSpace(input.ClientID),
	}, nil
}

func (service *AgentRuntime) StreamSession(
	ctx context.Context,
	userID string,
	friendlyID string,
	onEvent func(ConversationEvent) error,
) error {
	return service.StreamSessionFromCursor(ctx, userID, friendlyID, 0, onEvent)
}

func (service *AgentRuntime) StreamSessionFromCursor(
	ctx context.Context,
	userID string,
	friendlyID string,
	afterCursor int64,
	onEvent func(ConversationEvent) error,
) error {
	session, err := service.chat.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return err
	}

	history, err := service.chat.GetHistory(ctx, userID, friendlyID)
	if err != nil {
		return err
	}
	if err := onEvent(ConversationEvent{State: "reconcile", Snapshot: &history, SessionKey: session.ID, Revision: history.Revision, ActiveRunIDs: history.ActiveRunIDs}); err != nil {
		return err
	}
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		events, err := service.readEvents(ctx, session.ID, afterCursor)
		if err != nil {
			return err
		}
		for _, event := range events {
			if err := onEvent(event); err != nil {
				return err
			}
			afterCursor = event.Cursor
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		case <-heartbeat.C:
			if err := onEvent(ConversationEvent{State: "heartbeat"}); err != nil {
				return err
			}
		}
	}

}

func (service *AgentRuntime) ResolveSession(
	ctx context.Context,
	userID string,
	friendlyID string,
) (sessionRecord, error) {
	return service.chat.findSessionByFriendlyID(ctx, userID, friendlyID)
}

func (service *AgentRuntime) CancelSessionRuns(
	ctx context.Context,
	userID string,
	friendlyID string,
) (bool, error) {
	session, err := service.chat.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return false, err
	}

	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id FROM chat_runs WHERE session_id=? AND status IN ('queued','preparing','running')`, session.ID)
	if err != nil {
		return false, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return false, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return false, err
	}
	rows.Close()
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `UPDATE chat_runs SET status='aborted',completed_at=?,lease_token='' WHERE id=?`, time.Now().UnixMilli(), id); err != nil {
			return false, err
		}
		if err := service.refreshTurnExec(ctx, tx, id, "aborted"); err != nil {
			return false, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM chat_jobs WHERE run_id=?`, id); err != nil {
			return false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	service.runMu.Lock()
	defer service.runMu.Unlock()
	for _, id := range ids {
		if cancel := service.runCancels[id]; cancel != nil {
			cancel()
		}
	}
	return len(ids) > 0, nil

}

func (service *AgentRuntime) activeRunIDsForSession(
	ctx context.Context,
	sessionID string,
) ([]string, error) {
	rows, err := service.db.QueryContext(ctx, `
		SELECT id
		FROM chat_runs
		WHERE session_id = ? AND status IN ('queued','preparing','running')
		ORDER BY started_at ASC, id ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("list active runs: %w", err)
	}
	defer rows.Close()

	runIDs := []string{}
	for rows.Next() {
		var runID string
		if err := rows.Scan(&runID); err != nil {
			return nil, fmt.Errorf("scan active run: %w", err)
		}
		runIDs = append(runIDs, runID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active runs: %w", err)
	}
	return runIDs, nil
}

func (service *AgentRuntime) insertRun(
	ctx context.Context,
	record executionRecord,
	input SubmitTurnInput,
	now int64,
) error {
	return service.insertRunExec(ctx, service.db, record, input, now)
}

func (service *AgentRuntime) insertRunExec(
	ctx context.Context,
	exec sqlExecutor,
	record executionRecord,
	input SubmitTurnInput,
	now int64,
) error {
	turnTimestamp := record.TurnTimestamp
	if turnTimestamp == 0 {
		turnTimestamp = now + 1
	}
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
	`, record.ID, record.UserID, record.SessionID, record.Status, record.Model, nullableString(record.IdempotencyKey), nullableString(record.AssistantTurnID), string(requestJSON), turnTimestamp, now); err != nil {
		return fmt.Errorf("insert run: %w", err)
	}

	if _, err := exec.ExecContext(ctx, `UPDATE chat_runs SET revision=?,user_message_id=?,lease_token=?,lease_until=? WHERE id=?`, record.Revision, input.ClientID, record.LeaseToken, time.Now().Add(workerLease).UnixMilli(), record.ID); err != nil {
		return err
	}
	if _, err := exec.ExecContext(ctx, `INSERT INTO chat_jobs(run_id,available_at) VALUES(?,?)`, record.ID, now); err != nil {
		return err
	}
	return service.refreshTurnExec(ctx, exec, record.ID, "delta")
}

func (service *AgentRuntime) findRunByIdempotencyKey(
	ctx context.Context,
	userID string,
	sessionID string,
	idempotencyKey string,
) (executionRecord, bool, error) {
	normalizedKey := strings.TrimSpace(idempotencyKey)
	if normalizedKey == "" {
		return executionRecord{}, false, nil
	}

	var record executionRecord
	var assistantMessageID sql.NullString
	err := service.db.QueryRowContext(ctx, `
		SELECT id, user_id, session_id, status, model, assistant_message_id,COALESCE(user_message_id,'')
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
		&record.UserTurnID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return executionRecord{}, false, nil
	}
	if err != nil {
		return executionRecord{}, false, fmt.Errorf("find idempotent run: %w", err)
	}
	record.IdempotencyKey = normalizedKey
	record.AssistantTurnID = nullStringValue(assistantMessageID)
	return record, true, nil
}

func isUniqueConstraintError(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}
