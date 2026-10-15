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

type newConversationInput struct {
	Label    string
	Settings ConversationSettings
}

type SubmitTurnInput struct {
	ExecutionID      string                `json:"-"`
	NewConversation  *newConversationInput `json:"-"`
	EditMessageID    string                `json:"-"`
	ExpectedRevision *int64                `json:"expectedRevision,omitempty"`
	FriendlyID       string                `json:"-"`
	Message          string                `json:"message"`
	Model            string                `json:"model"`
	SystemPrompt     string                `json:"systemPrompt"`
	WebSearch        bool                  `json:"webSearch"`
	MathTools        bool                  `json:"mathTools"`
	Advanced         *ChatAdvancedOptions  `json:"advanced"`
	IdempotencyKey   string                `json:"idempotencyKey"`
	ClientID         string                `json:"clientId"`
	ClientTime       string                `json:"clientTime"`
	ClientTimeZone   string                `json:"clientTimeZone"`
	Attachments      []AttachmentPayload   `json:"attachments"`
}

type AttachmentPayload struct {
	MimeType string `json:"mimeType"`
	Content  string `json:"content"`
}

type SubmitTurnResult struct {
	CommandChanges
	Revision        int64          `json:"revision"`
	UserTurn        map[string]any `json:"userTurn,omitempty"`
	FriendlyID      string         `json:"friendlyId,omitempty"`
	RunID           string         `json:"runId"`
	SessionKey      string         `json:"sessionKey"`
	UserTurnID      string         `json:"userTurnId"`
	AssistantTurnID string         `json:"assistantTurnId"`
	ClientID        string         `json:"clientId,omitempty"`
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

type executionControl struct {
	LeaseToken string
	Cancel     context.CancelFunc
}

type AgentRuntime struct {
	mcp           *MCPService
	shutdownOnce  sync.Once
	workerOnce    sync.Once
	workerCancel  context.CancelFunc
	workerContext context.Context
	workerWG      sync.WaitGroup
	wake          chan struct{}
	db            *sql.DB
	conversations *ConversationService
	providers     *ProviderService
	webSettings   *WebToolSettingsService
	toolRuntime   func(ctx context.Context, userID string, input SubmitTurnInput) (toolExecutor, error)
	dispatchMu    sync.Mutex
	afterClaim    func(executionRecord)
	runMu         sync.Mutex
	runControls   map[string]executionControl
}

func NewAgentRuntime(
	db *sql.DB,
	conversations *ConversationService,
	providers *ProviderService,
	webSettings *WebToolSettingsService,
) *AgentRuntime {
	service := &AgentRuntime{
		wake:          make(chan struct{}, 1),
		db:            db,
		conversations: conversations,
		providers:     providers,
		webSettings:   webSettings,
		runControls:   make(map[string]executionControl),
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
	if service.mcp != nil {
		return service.mcp.Registry(ctx, userID, input.ExecutionID, runtime)
	}
	return runtime, nil
}

func (service *AgentRuntime) StartRun(
	ctx context.Context,
	userID string,
	input SubmitTurnInput,
) (SubmitTurnResult, error) {
	acceptanceStarted := time.Now()
	service.conversations.commandMu.Lock()
	defer service.conversations.commandMu.Unlock()
	var session sessionRecord
	var err error
	creating := input.NewConversation != nil
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if creating && idempotencyKey != "" {
		var existingID string
		lookupErr := service.db.QueryRowContext(ctx, `SELECT session_id FROM conversation_commands WHERE user_id=? AND command_key=?`, userID, idempotencyKey).Scan(&existingID)
		if lookupErr == nil {
			session, err = service.conversations.findSessionByID(ctx, userID, existingID)
			creating = false
			input.FriendlyID = session.FriendlyID
		} else if !errors.Is(lookupErr, sql.ErrNoRows) {
			return SubmitTurnResult{}, lookupErr
		}
	}
	if creating {
		settingsJSON, encodeErr := encodeConversationSettings(input.NewConversation.Settings)
		if encodeErr != nil {
			return SubmitTurnResult{}, encodeErr
		}
		label := nullableString(normalizeSessionLabel(input.NewConversation.Label))
		session = sessionRecord{ID: newID(), UserID: userID, FriendlyID: newFriendlyID(), Title: label, DerivedTitle: label, Label: label, ContextTokens: defaultContextTokens, ConversationSettingsJSON: settingsJSON}
	} else if session.ID == "" {
		session, err = service.conversations.findSessionByFriendlyID(ctx, userID, input.FriendlyID)
	}
	if err != nil {
		return SubmitTurnResult{}, err
	}
	input.FriendlyID = session.FriendlyID
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
				Revision:        existingRun.Revision,
				FriendlyID:      session.FriendlyID,
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

	userMessage := make(map[string]any)
	if input.EditMessageID == "" {
		userMessage, _, err = buildUserMessage(input.Message, input.Attachments, input.ClientID)
		if err != nil {
			return SubmitTurnResult{}, err
		}
		if err := service.conversations.assets.storeMessage(ctx, userID, userMessage); err != nil {
			return SubmitTurnResult{}, err
		}
	}
	now := time.Now().UnixMilli()
	userMessage["timestamp"] = now
	runID := newID()
	assistantTurnID := newID()
	model := normalizeModel(input.Model)
	record := executionRecord{
		ID:              runID,
		UserID:          userID,
		SessionID:       session.ID,
		Status:          "queued",
		AcceptedAt:      now,
		Model:           model,
		IdempotencyKey:  idempotencyKey,
		AssistantTurnID: assistantTurnID,
	}

	transaction, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return SubmitTurnResult{}, fmt.Errorf("begin run tx: %w", err)
	}
	defer transaction.Rollback()

	if creating {
		if _, err := transaction.ExecContext(ctx, `INSERT INTO chat_sessions(id,user_id,friendly_id,title,derived_title,label,is_pinned,updated_at,created_at,total_tokens,context_tokens,conversation_settings_json) VALUES(?,?,?,?,?,?,0,?,?,0,?,?)`, session.ID, userID, session.FriendlyID, session.Title, session.DerivedTitle, session.Label, now, now, defaultContextTokens, session.ConversationSettingsJSON); err != nil {
			return SubmitTurnResult{}, err
		}
		if idempotencyKey != "" {
			if _, err := transaction.ExecContext(ctx, `INSERT INTO conversation_commands(user_id,command_key,session_id) VALUES(?,?,?)`, userID, idempotencyKey, session.ID); err != nil {
				return SubmitTurnResult{}, err
			}
		}
	}
	if !creating {
		session, err = service.conversations.findSessionExec(ctx, transaction, userID, "id", session.ID)
		if err != nil {
			return SubmitTurnResult{}, err
		}
	}
	if err := transaction.QueryRowContext(ctx, `SELECT revision FROM chat_sessions WHERE id=?`, session.ID).Scan(&record.Revision); err != nil {
		return SubmitTurnResult{}, err
	}
	if input.ExpectedRevision != nil && *input.ExpectedRevision != record.Revision {
		return SubmitTurnResult{}, errConversationConflict
	}
	if input.EditMessageID != "" {
		records, err := service.conversations.listMessageRecordsExec(ctx, transaction, session.ID)
		if err != nil {
			return SubmitTurnResult{}, err
		}
		index := findMessageRecordIndex(records, input.EditMessageID)
		if index < 0 || records[index].Role != "user" {
			return SubmitTurnResult{}, errConversationConflict
		}
		preserved := make([]chatMessageContentPart, 0)
		for _, part := range contentPartsFromAny(records[index].Message["content"]) {
			if part.Type == "image" {
				preserved = append(preserved, part)
			}
		}
		if strings.TrimSpace(input.Message) != "" {
			preserved = append(preserved, newTextContentPart(input.Message))
		}
		if len(preserved) == 0 {
			return SubmitTurnResult{}, fmt.Errorf("message must not be empty")
		}
		userMessage = (chatMessage{ID: input.EditMessageID, Role: "user", ClientID: input.ClientID, Content: preserved}).toMap()
		userMessage["id"] = input.EditMessageID
		userMessage["timestamp"] = now
		session.CommandChanges, err = collectCommandChanges(ctx, transaction, session.ID, records[index].Timestamp, input.EditMessageID)
		if err != nil {
			return SubmitTurnResult{}, err
		}
		if err := service.conversations.truncateSessionMessagesExec(ctx, transaction, &session, records, index); err != nil {
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

	if input.EditMessageID == "" {
		record.Revision++
		if _, err := transaction.ExecContext(ctx, `UPDATE chat_sessions SET revision=? WHERE id=?`, record.Revision, session.ID); err != nil {
			return SubmitTurnResult{}, err
		}
	}
	userMessage["revision"] = record.Revision
	var latestTimestamp int64
	if err := transaction.QueryRowContext(ctx, `SELECT MAX(COALESCE((SELECT MAX(timestamp) FROM chat_messages WHERE session_id=?),0),COALESCE((SELECT MAX(started_at) FROM chat_runs WHERE session_id=? AND invalidated=0),0))`, session.ID, session.ID).Scan(&latestTimestamp); err != nil {
		return SubmitTurnResult{}, err
	}
	userTimestamp := maxInt64(now, latestTimestamp+1)
	userMessage["timestamp"] = userTimestamp
	record.TurnTimestamp = userTimestamp + 1
	if _, err := service.conversations.appendMessageWithOptionsExec(
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
					Revision:        existingRun.Revision,
					FriendlyID:      session.FriendlyID,
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
		service.maybeGenerateSessionTitle(session, input, userMessage, titlePreferences, record.Revision)
	}
	service.notifyQueue()
	log.Printf("kairos: stage=accepted run=%s revision=%d acceptance_ms=%d", record.ID, record.Revision, time.Since(acceptanceStarted).Milliseconds())

	return SubmitTurnResult{
		CommandChanges: session.CommandChanges, Revision: record.Revision, UserTurn: userMessage,
		RunID:           runID,
		FriendlyID:      session.FriendlyID,
		SessionKey:      session.ID,
		UserTurnID:      stringValueFromMap(userMessage, "id"),
		AssistantTurnID: assistantTurnID,
		ClientID:        strings.TrimSpace(input.ClientID),
	}, nil
}

func (service *AgentRuntime) CancelSessionRuns(
	ctx context.Context,
	userID string,
	friendlyID string,
) (bool, error) {
	return service.cancelRuns(ctx, userID, friendlyID, "")
}

func (service *AgentRuntime) CancelRun(ctx context.Context, userID, friendlyID, runID string) (bool, error) {
	if strings.TrimSpace(runID) == "" {
		return false, errors.New("runId is required")
	}
	return service.cancelRuns(ctx, userID, friendlyID, runID)
}

func (service *AgentRuntime) cancelRuns(ctx context.Context, userID, friendlyID, runID string) (bool, error) {
	session, err := service.conversations.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return false, err
	}

	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id FROM chat_runs WHERE session_id=? AND status IN ('queued','preparing','running') AND (?='' OR id=?)`, session.ID, runID, runID)
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
		if control, ok := service.runControls[id]; ok {
			control.Cancel()
		}
	}
	return len(ids) > 0, nil

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
	// Attachments are persisted in the user message, never duplicate bytes in the job.
	input.Attachments = nil
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
	log.Printf("kairos: stage=job_enqueue run=%s", record.ID)
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
	var assistantTurnID sql.NullString
	err := service.db.QueryRowContext(ctx, `
		SELECT id, user_id, session_id, status, model, assistant_message_id,COALESCE(user_message_id,''),revision
		FROM chat_runs
		WHERE user_id = ? AND session_id = ? AND idempotency_key = ?
		LIMIT 1
	`, userID, sessionID, normalizedKey).Scan(
		&record.ID,
		&record.UserID,
		&record.SessionID,
		&record.Status,
		&record.Model,
		&assistantTurnID,
		&record.UserTurnID,
		&record.Revision,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return executionRecord{}, false, nil
	}
	if err != nil {
		return executionRecord{}, false, fmt.Errorf("find idempotent run: %w", err)
	}
	record.IdempotencyKey = normalizedKey
	record.AssistantTurnID = nullStringValue(assistantTurnID)
	return record, true, nil
}

func isUniqueConstraintError(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint")
}

// Long-lived HTTP streams participate in service shutdown as well as client cancellation.
func (service *AgentRuntime) requestContext(parent context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(parent)
	if service.workerContext == nil {
		return ctx, cancel
	}
	if service.workerContext.Err() != nil {
		cancel()
	}
	stop := context.AfterFunc(service.workerContext, cancel)
	return ctx, func() { stop(); cancel() }
}
