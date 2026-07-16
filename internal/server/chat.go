package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const defaultContextTokens = 32768

var errChatSessionNotFound = errors.New("chat session not found")

type SessionSummary struct {
	Key           string         `json:"key"`
	FriendlyID    string         `json:"friendlyId"`
	Title         string         `json:"title,omitempty"`
	DerivedTitle  string         `json:"derivedTitle,omitempty"`
	Label         string         `json:"label,omitempty"`
	IsPinned      bool           `json:"isPinned,omitempty"`
	UpdatedAt     int64          `json:"updatedAt,omitempty"`
	LastMessage   map[string]any `json:"lastMessage,omitempty"`
	TotalTokens   int64          `json:"totalTokens,omitempty"`
	ContextTokens int64          `json:"contextTokens,omitempty"`
}

type HistoryPayload struct {
	SessionKey string           `json:"sessionKey"`
	SessionID  string           `json:"sessionId,omitempty"`
	Messages   []map[string]any `json:"messages"`
}

type ChatService struct {
	db *sql.DB
}

type sessionRecord struct {
	ID              string
	UserID          string
	FriendlyID      string
	Title           sql.NullString
	DerivedTitle    sql.NullString
	Label           sql.NullString
	IsPinned        bool
	UpdatedAt       int64
	LastMessageJSON sql.NullString
	TotalTokens     int64
	ContextTokens   int64
}

type messageRecord struct {
	StorageID    string
	MessageID    string
	Role         string
	ContentJSON  string
	MessageJSON  string
	Timestamp    int64
	CreatedAt    int64
	RunID        sql.NullString
	RoundIndex   sql.NullInt64
	MessageIndex sql.NullInt64
	Message      map[string]any
}

type appendMessageOptions struct {
	SkipDerivedTitle bool
}

type sqlExecutor interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func NewChatService(db *sql.DB) *ChatService {
	return &ChatService{db: db}
}

func (service *ChatService) ListSessions(
	ctx context.Context,
	userID string,
) ([]SessionSummary, error) {
	rows, err := service.db.QueryContext(ctx, `
		SELECT
			id,
			user_id,
			friendly_id,
			title,
			derived_title,
			label,
			is_pinned,
			updated_at,
			last_message_json,
			total_tokens,
			context_tokens
		FROM chat_sessions
		WHERE user_id = ?
		ORDER BY is_pinned DESC, updated_at DESC, created_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	summaries := make([]SessionSummary, 0)
	for rows.Next() {
		record, err := scanSessionRecord(rows)
		if err != nil {
			return nil, err
		}
		summary, err := sessionRecordToSummary(record)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, summary)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sessions: %w", err)
	}

	return summaries, nil
}

func (service *ChatService) CreateSession(
	ctx context.Context,
	userID string,
	label string,
) (SessionSummary, error) {
	now := time.Now().UnixMilli()
	sessionID := newID()
	friendlyID := newFriendlyID()
	normalizedLabel := normalizeSessionLabel(label)

	if _, err := service.db.ExecContext(ctx, `
		INSERT INTO chat_sessions(
			id,
			user_id,
			friendly_id,
			title,
			derived_title,
			label,
			is_pinned,
			updated_at,
			created_at,
				total_tokens,
				context_tokens
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
	`, sessionID, userID, friendlyID, nullableString(normalizedLabel), nullableString(normalizedLabel), nullableString(normalizedLabel), 0, now, now, defaultContextTokens); err != nil {
		return SessionSummary{}, fmt.Errorf("create session: %w", err)
	}

	return SessionSummary{
		Key:           sessionID,
		FriendlyID:    friendlyID,
		Title:         normalizedLabel,
		DerivedTitle:  normalizedLabel,
		Label:         normalizedLabel,
		IsPinned:      false,
		UpdatedAt:     now,
		TotalTokens:   0,
		ContextTokens: defaultContextTokens,
	}, nil
}

func (service *ChatService) GetSessionSummary(
	ctx context.Context,
	userID string,
	friendlyID string,
) (SessionSummary, error) {
	record, err := service.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return SessionSummary{}, err
	}
	return sessionRecordToSummary(record)
}

func (service *ChatService) PinSession(
	ctx context.Context,
	userID string,
	friendlyID string,
	isPinned bool,
) (SessionSummary, error) {
	record, err := service.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return SessionSummary{}, err
	}

	if _, err := service.db.ExecContext(ctx, `
		UPDATE chat_sessions
		SET is_pinned = ?
		WHERE id = ? AND user_id = ?
	`, boolAsInt(isPinned), record.ID, userID); err != nil {
		return SessionSummary{}, fmt.Errorf("pin session: %w", err)
	}

	record.IsPinned = isPinned
	return sessionRecordToSummary(record)
}

func (service *ChatService) RenameSession(
	ctx context.Context,
	userID string,
	friendlyID string,
	label string,
) (SessionSummary, error) {
	record, err := service.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return SessionSummary{}, err
	}

	normalizedLabel := normalizeSessionLabel(label)
	now := time.Now().UnixMilli()
	if _, err := service.db.ExecContext(ctx, `
		UPDATE chat_sessions
		SET title = ?, label = ?, updated_at = ?
		WHERE id = ? AND user_id = ?
	`, nullableString(normalizedLabel), nullableString(normalizedLabel), now, record.ID, userID); err != nil {
		return SessionSummary{}, fmt.Errorf("rename session: %w", err)
	}

	record.Title = nullableString(normalizedLabel)
	record.Label = nullableString(normalizedLabel)
	record.UpdatedAt = now
	return sessionRecordToSummary(record)
}

func (service *ChatService) DeleteSession(
	ctx context.Context,
	userID string,
	friendlyID string,
) error {
	result, err := service.db.ExecContext(ctx, `
		DELETE FROM chat_sessions
		WHERE user_id = ? AND friendly_id = ?
	`, userID, strings.TrimSpace(friendlyID))
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete session rows: %w", err)
	}
	if rowsAffected == 0 {
		return errChatSessionNotFound
	}

	return nil
}

func (service *ChatService) GetHistory(
	ctx context.Context,
	userID string,
	friendlyID string,
) (HistoryPayload, error) {
	record, err := service.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return HistoryPayload{}, err
	}

	messageRecords, err := service.listMessageRecords(ctx, record.ID)
	if err != nil {
		return HistoryPayload{}, err
	}

	messages := make([]map[string]any, 0, len(messageRecords))
	for _, record := range messageRecords {
		messages = append(messages, record.Message)
	}

	return HistoryPayload{
		SessionKey: record.ID,
		SessionID:  record.FriendlyID,
		Messages:   messages,
	}, nil
}

func (service *ChatService) CloneSession(
	ctx context.Context,
	userID string,
	friendlyID string,
	messageID string,
) (SessionSummary, error) {
	source, err := service.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return SessionSummary{}, err
	}

	messageRecords, err := service.listMessageRecords(ctx, source.ID)
	if err != nil {
		return SessionSummary{}, err
	}

	cloneIndex := findMessageRecordIndex(messageRecords, messageID)
	if cloneIndex < 0 {
		return SessionSummary{}, fmt.Errorf("clone point message not found")
	}

	return service.createClonedSession(ctx, source, messageRecords[:cloneIndex+1])
}

func (service *ChatService) DeleteUserMessage(
	ctx context.Context,
	userID string,
	friendlyID string,
	messageID string,
) (SessionSummary, error) {
	source, err := service.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return SessionSummary{}, err
	}

	messageRecords, err := service.listMessageRecords(ctx, source.ID)
	if err != nil {
		return SessionSummary{}, err
	}

	messageIndex := findMessageRecordIndex(messageRecords, messageID)
	if messageIndex < 0 {
		return SessionSummary{}, fmt.Errorf("user message not found")
	}
	if messageRecords[messageIndex].Role != "user" {
		return SessionSummary{}, fmt.Errorf("only user messages can be deleted")
	}

	return service.truncateSessionMessages(ctx, source, messageRecords, messageIndex)
}

func (service *ChatService) EditUserMessage(
	ctx context.Context,
	userID string,
	friendlyID string,
	messageID string,
	message string,
) (SessionSummary, []AttachmentPayload, error) {
	source, err := service.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return SessionSummary{}, nil, err
	}

	messageRecords, err := service.listMessageRecords(ctx, source.ID)
	if err != nil {
		return SessionSummary{}, nil, err
	}

	messageIndex := findMessageRecordIndex(messageRecords, messageID)
	if messageIndex < 0 {
		return SessionSummary{}, nil, fmt.Errorf("user message not found")
	}

	target := messageRecords[messageIndex]
	if target.Role != "user" {
		return SessionSummary{}, nil, fmt.Errorf("only user messages can be edited")
	}

	session, err := service.truncateSessionMessages(ctx, source, messageRecords, messageIndex)
	if err != nil {
		return SessionSummary{}, nil, err
	}

	return session, extractAttachmentPayloads(target.Message), nil
}

func (service *ChatService) truncateSessionMessages(
	ctx context.Context,
	session sessionRecord,
	messageRecords []messageRecord,
	startIndex int,
) (SessionSummary, error) {
	if startIndex < 0 || startIndex > len(messageRecords) {
		return SessionSummary{}, fmt.Errorf("invalid message truncate index")
	}

	remainingRecords := messageRecords[:startIndex]
	deletedRecords := messageRecords[startIndex:]
	now := time.Now().UnixMilli()
	derivedTitle := deriveTitleFromMessages(remainingRecords)
	totalTokens := countMessageRecordTokens(remainingRecords)
	var lastMessageJSON sql.NullString
	if len(remainingRecords) > 0 {
		lastMessageJSON = nullableString(remainingRecords[len(remainingRecords)-1].MessageJSON)
	}

	transaction, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionSummary{}, fmt.Errorf("begin truncate messages tx: %w", err)
	}
	defer transaction.Rollback()

	if len(deletedRecords) > 0 {
		placeholders := make([]string, 0, len(deletedRecords))
		args := make([]any, 0, len(deletedRecords)+1)
		args = append(args, session.ID)
		for _, record := range deletedRecords {
			placeholders = append(placeholders, "?")
			args = append(args, record.StorageID)
		}
		query := fmt.Sprintf(
			"DELETE FROM chat_messages WHERE session_id = ? AND id IN (%s)",
			strings.Join(placeholders, ","),
		)
		if _, err := transaction.ExecContext(ctx, query, args...); err != nil {
			return SessionSummary{}, fmt.Errorf("delete truncated messages: %w", err)
		}
	}

	if _, err := transaction.ExecContext(ctx, `
		UPDATE chat_sessions
		SET
			last_message_json = ?,
			updated_at = ?,
			derived_title = ?,
			total_tokens = ?
		WHERE id = ? AND user_id = ?
	`, lastMessageJSON, now, nullableString(derivedTitle), totalTokens, session.ID, session.UserID); err != nil {
		return SessionSummary{}, fmt.Errorf("update session after truncate: %w", err)
	}

	if err := transaction.Commit(); err != nil {
		return SessionSummary{}, fmt.Errorf("commit truncate messages: %w", err)
	}

	session.LastMessageJSON = lastMessageJSON
	session.UpdatedAt = now
	session.DerivedTitle = nullableString(derivedTitle)
	session.TotalTokens = totalTokens
	return sessionRecordToSummary(session)
}

func (service *ChatService) appendMessage(
	ctx context.Context,
	session sessionRecord,
	message map[string]any,
	timestamp int64,
) (SessionSummary, error) {
	return service.appendMessageWithOptions(
		ctx,
		session,
		message,
		timestamp,
		appendMessageOptions{},
	)
}

func (service *ChatService) appendMessageWithOptions(
	ctx context.Context,
	session sessionRecord,
	message map[string]any,
	timestamp int64,
	options appendMessageOptions,
) (SessionSummary, error) {
	return service.appendMessageWithOptionsExec(
		ctx,
		service.db,
		session,
		message,
		timestamp,
		options,
	)
}

func (service *ChatService) appendMessagesWithOptions(
	ctx context.Context,
	session sessionRecord,
	messages []map[string]any,
	options appendMessageOptions,
) (SessionSummary, error) {
	if len(messages) == 0 {
		return sessionRecordToSummary(session)
	}
	transaction, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionSummary{}, fmt.Errorf("begin append messages tx: %w", err)
	}
	defer transaction.Rollback()

	var summary SessionSummary
	current := session
	for _, message := range messages {
		timestamp := int64Value(message["timestamp"])
		if timestamp == 0 {
			timestamp = time.Now().UnixMilli()
			message["timestamp"] = timestamp
		}
		summary, err = service.appendMessageWithOptionsExec(ctx, transaction, current, message, timestamp, options)
		if err != nil {
			return SessionSummary{}, err
		}
		current.LastMessageJSON = nullableJSONObject(message)
		current.UpdatedAt = summary.UpdatedAt
		current.TotalTokens = summary.TotalTokens
		if summary.DerivedTitle != "" {
			current.DerivedTitle = nullableString(summary.DerivedTitle)
		}
	}
	if err := transaction.Commit(); err != nil {
		return SessionSummary{}, fmt.Errorf("commit append messages tx: %w", err)
	}
	return summary, nil
}

func (service *ChatService) removeTrailingUserMessageExec(
	ctx context.Context,
	exec sqlExecutor,
	session sessionRecord,
) (sessionRecord, error) {
	var storageID string
	var messageJSON string
	var timestamp int64
	err := exec.QueryRowContext(ctx, `
		SELECT id, message_json, timestamp
		FROM chat_messages
		WHERE session_id = ?
		ORDER BY timestamp DESC, created_at DESC, id DESC
		LIMIT 1
	`, session.ID).Scan(&storageID, &messageJSON, &timestamp)
	if errors.Is(err, sql.ErrNoRows) {
		return session, nil
	}
	if err != nil {
		return sessionRecord{}, fmt.Errorf("load trailing message: %w", err)
	}

	var message map[string]any
	if err := json.Unmarshal([]byte(messageJSON), &message); err != nil {
		return sessionRecord{}, fmt.Errorf("decode trailing message: %w", err)
	}
	if stringValueFromMap(message, "role") != "user" {
		return session, nil
	}

	if _, err := exec.ExecContext(ctx, `
		DELETE FROM chat_messages
		WHERE session_id = ? AND id = ?
	`, session.ID, storageID); err != nil {
		return sessionRecord{}, fmt.Errorf("delete trailing user message: %w", err)
	}

	var previousMessageJSON string
	var previousTimestamp int64
	previousErr := exec.QueryRowContext(ctx, `
		SELECT message_json, timestamp
		FROM chat_messages
		WHERE session_id = ?
		ORDER BY timestamp DESC, created_at DESC, id DESC
		LIMIT 1
	`, session.ID).Scan(&previousMessageJSON, &previousTimestamp)

	lastMessageJSON := sql.NullString{}
	updatedAt := time.Now().UnixMilli()
	if previousErr == nil {
		lastMessageJSON = nullableString(previousMessageJSON)
		updatedAt = previousTimestamp
	} else if !errors.Is(previousErr, sql.ErrNoRows) {
		return sessionRecord{}, fmt.Errorf("load previous message after dedupe: %w", previousErr)
	}

	totalTokens := maxInt64(0, session.TotalTokens-approximateMessageTokens(message))
	derivedTitle := session.DerivedTitle
	if !lastMessageJSON.Valid {
		derivedTitle = sql.NullString{}
	}
	if _, err := exec.ExecContext(ctx, `
		UPDATE chat_sessions
		SET
			last_message_json = ?,
			updated_at = ?,
			derived_title = ?,
			total_tokens = ?
		WHERE id = ? AND user_id = ?
	`, lastMessageJSON, updatedAt, derivedTitle, totalTokens, session.ID, session.UserID); err != nil {
		return sessionRecord{}, fmt.Errorf("update session after dedupe: %w", err)
	}

	session.LastMessageJSON = lastMessageJSON
	session.UpdatedAt = updatedAt
	session.DerivedTitle = derivedTitle
	session.TotalTokens = totalTokens
	return session, nil
}

func (service *ChatService) appendMessageWithOptionsExec(
	ctx context.Context,
	exec sqlExecutor,
	session sessionRecord,
	message map[string]any,
	timestamp int64,
	options appendMessageOptions,
) (SessionSummary, error) {
	messageJSON, err := json.Marshal(message)
	if err != nil {
		return SessionSummary{}, fmt.Errorf("encode message: %w", err)
	}

	contentJSON, err := encodeMessageContent(message["content"])
	if err != nil {
		return SessionSummary{}, err
	}

	now := time.Now().UnixMilli()
	totalTokens := session.TotalTokens + approximateMessageTokens(message)
	derivedTitle := nullStringValue(session.DerivedTitle)
	if derivedTitle == "" && !options.SkipDerivedTitle {
		derivedTitle = deriveTitleFromMessage(message)
	}

	if _, err := exec.ExecContext(ctx, `
		INSERT INTO chat_messages(
			id,
			session_id,
			role,
			model,
			model_name,
			model_description,
			content_json,
			tool_call_id,
			tool_name,
			details_json,
			is_error,
			timestamp,
			run_id,
			round_index,
			message_index,
			message_json,
			created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, messageIDFromMap(message), session.ID, stringValueFromMap(message, "role"), stringValueFromMap(message, "model"), stringValueFromMap(message, "modelName"), stringValueFromMap(message, "modelDescription"), contentJSON, stringValueFromMap(message, "toolCallId"), stringValueFromMap(message, "toolName"), nullableJSONObject(message["details"]), boolAsInt(boolValueFromMap(message, "isError")), timestamp, nullableString(stringValueFromMap(message, "runId")), nullableInt64FromMap(message, "roundIndex"), nullableInt64FromMap(message, "messageIndex"), string(messageJSON), now); err != nil {
		return SessionSummary{}, fmt.Errorf("insert chat message: %w", err)
	}

	if _, err := exec.ExecContext(ctx, `
		UPDATE chat_sessions
		SET
			last_message_json = ?,
			updated_at = ?,
			derived_title = COALESCE(NULLIF(derived_title, ''), ?),
			total_tokens = ?
		WHERE id = ? AND user_id = ?
	`, string(messageJSON), timestamp, nullableString(derivedTitle), totalTokens, session.ID, session.UserID); err != nil {
		return SessionSummary{}, fmt.Errorf("update session after message: %w", err)
	}

	session.LastMessageJSON = nullableString(string(messageJSON))
	session.UpdatedAt = timestamp
	session.TotalTokens = totalTokens
	if derivedTitle != "" {
		session.DerivedTitle = nullableString(derivedTitle)
	}
	return sessionRecordToSummary(session)
}

func (service *ChatService) UpdateSessionContextTokens(
	ctx context.Context,
	sessionID string,
	userID string,
	contextTokens int64,
) error {
	if contextTokens <= 0 {
		return nil
	}

	if _, err := service.db.ExecContext(ctx, `
		UPDATE chat_sessions
		SET context_tokens = ?
		WHERE id = ? AND user_id = ?
	`, contextTokens, sessionID, userID); err != nil {
		return fmt.Errorf("update session context tokens: %w", err)
	}

	return nil
}

func (service *ChatService) UpdateSessionTotalTokens(
	ctx context.Context,
	sessionID string,
	userID string,
	totalTokens int64,
) error {
	if totalTokens <= 0 {
		return nil
	}

	if _, err := service.db.ExecContext(ctx, `
		UPDATE chat_sessions
		SET total_tokens = ?
		WHERE id = ? AND user_id = ?
	`, totalTokens, sessionID, userID); err != nil {
		return fmt.Errorf("update session total tokens: %w", err)
	}

	return nil
}

func (service *ChatService) UpdateSessionTitleIfEmpty(
	ctx context.Context,
	sessionID string,
	userID string,
	title string,
) (SessionSummary, bool, error) {
	normalizedTitle := strings.TrimSpace(title)
	if normalizedTitle == "" {
		return SessionSummary{}, false, nil
	}

	result, err := service.db.ExecContext(ctx, `
		UPDATE chat_sessions
		SET title = ?
		WHERE
			id = ? AND
			user_id = ? AND
			COALESCE(NULLIF(title, ''), '') = '' AND
			COALESCE(NULLIF(label, ''), '') = ''
	`, normalizedTitle, sessionID, userID)
	if err != nil {
		return SessionSummary{}, false, fmt.Errorf("update session title: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return SessionSummary{}, false, fmt.Errorf("session title rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return SessionSummary{}, false, nil
	}

	record, err := service.findSessionByID(ctx, userID, sessionID)
	if err != nil {
		return SessionSummary{}, false, err
	}
	summary, err := sessionRecordToSummary(record)
	if err != nil {
		return SessionSummary{}, false, err
	}
	return summary, true, nil
}

func (service *ChatService) listMessageRecords(
	ctx context.Context,
	sessionID string,
) ([]messageRecord, error) {
	rows, err := service.db.QueryContext(ctx, `
		SELECT
			id,
			role,
			content_json,
			message_json,
			timestamp,
			created_at,
			run_id,
			round_index,
			message_index
		FROM chat_messages
		WHERE session_id = ?
		ORDER BY timestamp ASC, created_at ASC, id ASC
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("list messages: %w", err)
	}
	defer rows.Close()

	records := make([]messageRecord, 0)
	for rows.Next() {
		var record messageRecord
		if err := rows.Scan(
			&record.StorageID,
			&record.Role,
			&record.ContentJSON,
			&record.MessageJSON,
			&record.Timestamp,
			&record.CreatedAt,
			&record.RunID,
			&record.RoundIndex,
			&record.MessageIndex,
		); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		message, err := decodeJSONObject(record.MessageJSON)
		if err != nil {
			return nil, err
		}
		record.Message = message
		record.MessageID = messageIDFromMap(message)
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate messages: %w", err)
	}

	return records, nil
}

func (service *ChatService) createClonedSession(
	ctx context.Context,
	source sessionRecord,
	messageRecords []messageRecord,
) (SessionSummary, error) {
	now := time.Now().UnixMilli()
	sessionID := newID()
	friendlyID := newFriendlyID()

	derivedTitle := deriveTitleFromMessages(messageRecords)
	forkedTitle := forkedCloneTitle(source, derivedTitle)
	totalTokens := countMessageRecordTokens(messageRecords)
	var lastMessageJSON sql.NullString
	if len(messageRecords) > 0 {
		lastMessageJSON = nullableString(messageRecords[len(messageRecords)-1].MessageJSON)
	}

	transaction, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionSummary{}, fmt.Errorf("begin clone session tx: %w", err)
	}
	defer transaction.Rollback()

	if _, err := transaction.ExecContext(ctx, `
		INSERT INTO chat_sessions(
			id,
			user_id,
			friendly_id,
			title,
			derived_title,
			label,
			is_pinned,
			updated_at,
			created_at,
				last_message_json,
				total_tokens,
				context_tokens
			)
			VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
		`, sessionID, source.UserID, friendlyID, nullableString(forkedTitle), nullableString(derivedTitle), 0, now, now, lastMessageJSON, totalTokens, source.ContextTokens); err != nil {
		return SessionSummary{}, fmt.Errorf("create clone session: %w", err)
	}

	for _, messageRecord := range messageRecords {
		if _, err := transaction.ExecContext(ctx, `
			INSERT INTO chat_messages(
				id,
				session_id,
				role,
				content_json,
				timestamp,
				run_id,
				round_index,
				message_index,
				message_json,
				created_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, newID(), sessionID, messageRecord.Role, messageRecord.ContentJSON, messageRecord.Timestamp, messageRecord.RunID, messageRecord.RoundIndex, messageRecord.MessageIndex, messageRecord.MessageJSON, now); err != nil {
			return SessionSummary{}, fmt.Errorf("copy clone message: %w", err)
		}
	}

	if err := transaction.Commit(); err != nil {
		return SessionSummary{}, fmt.Errorf("commit clone session: %w", err)
	}

	return SessionSummary{
		Key:           sessionID,
		FriendlyID:    friendlyID,
		Title:         forkedTitle,
		DerivedTitle:  derivedTitle,
		IsPinned:      false,
		UpdatedAt:     now,
		LastMessage:   lastMessageFromRecords(messageRecords),
		TotalTokens:   totalTokens,
		ContextTokens: source.ContextTokens,
	}, nil
}

func (service *ChatService) findSessionByFriendlyID(
	ctx context.Context,
	userID string,
	friendlyID string,
) (sessionRecord, error) {
	return service.findSession(ctx, userID, "friendly_id", strings.TrimSpace(friendlyID))
}

func (service *ChatService) findSessionByID(
	ctx context.Context,
	userID string,
	sessionID string,
) (sessionRecord, error) {
	return service.findSession(ctx, userID, "id", strings.TrimSpace(sessionID))
}

func (service *ChatService) findSession(
	ctx context.Context,
	userID string,
	field string,
	value string,
) (sessionRecord, error) {
	var record sessionRecord
	err := service.db.QueryRowContext(ctx, `
		SELECT
			id,
			user_id,
			friendly_id,
			title,
			derived_title,
			label,
			is_pinned,
			updated_at,
			last_message_json,
			total_tokens,
			context_tokens
		FROM chat_sessions
		WHERE user_id = ? AND `+field+` = ?
	`, userID, value).Scan(
		&record.ID,
		&record.UserID,
		&record.FriendlyID,
		&record.Title,
		&record.DerivedTitle,
		&record.Label,
		&record.IsPinned,
		&record.UpdatedAt,
		&record.LastMessageJSON,
		&record.TotalTokens,
		&record.ContextTokens,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return sessionRecord{}, errChatSessionNotFound
		}
		return sessionRecord{}, fmt.Errorf("lookup session: %w", err)
	}
	return record, nil
}

func scanSessionRecord(scanner interface {
	Scan(dest ...any) error
}) (sessionRecord, error) {
	var record sessionRecord
	if err := scanner.Scan(
		&record.ID,
		&record.UserID,
		&record.FriendlyID,
		&record.Title,
		&record.DerivedTitle,
		&record.Label,
		&record.IsPinned,
		&record.UpdatedAt,
		&record.LastMessageJSON,
		&record.TotalTokens,
		&record.ContextTokens,
	); err != nil {
		return sessionRecord{}, fmt.Errorf("scan session: %w", err)
	}
	return record, nil
}

func findMessageRecordIndex(records []messageRecord, messageID string) int {
	needle := strings.TrimSpace(messageID)
	for index, record := range records {
		if record.MessageID == needle {
			return index
		}
	}
	return -1
}

func deriveTitleFromMessages(records []messageRecord) string {
	for _, record := range records {
		title := deriveTitleFromMessage(record.Message)
		if title != "" {
			return title
		}
	}
	return ""
}

func forkedCloneTitle(source sessionRecord, copiedDerivedTitle string) string {
	base := firstNonEmpty(
		nullStringValue(source.Label),
		nullStringValue(source.Title),
		nullStringValue(source.DerivedTitle),
		copiedDerivedTitle,
	)
	if base == "" {
		return ""
	}
	for {
		trimmed := strings.TrimSpace(base)
		if !strings.HasSuffix(strings.ToLower(trimmed), " (forked)") {
			base = trimmed
			break
		}
		base = strings.TrimSpace(trimmed[:len(trimmed)-len(" (forked)")])
		if base == "" {
			return ""
		}
	}
	return base + " (forked)"
}

func countMessageRecordTokens(records []messageRecord) int64 {
	for index := len(records) - 1; index >= 0; index -= 1 {
		message := records[index].Message
		if stringValueFromMap(message, "role") != "assistant" {
			continue
		}
		usage := mapValueFromMap(mapValueFromMap(message, "details"), "usage")
		if total := int64Value(usage["totalTokens"]); total > 0 {
			return total
		}
	}
	var total int64
	for _, record := range records {
		total += approximateMessageTokens(record.Message)
	}
	return total
}

func lastMessageFromRecords(records []messageRecord) map[string]any {
	if len(records) == 0 {
		return nil
	}
	return records[len(records)-1].Message
}

func extractAttachmentPayloads(message map[string]any) []AttachmentPayload {
	attachments := make([]AttachmentPayload, 0)
	for _, part := range contentPartsFromAny(message["content"]) {
		if strings.TrimSpace(part.Type) != "image" || part.Source == nil {
			continue
		}
		if strings.TrimSpace(part.Source.Type) != "base64" {
			continue
		}
		mimeType := strings.TrimSpace(part.Source.MediaType)
		content := strings.TrimSpace(part.Source.Data)
		if mimeType == "" || content == "" {
			continue
		}
		attachments = append(attachments, AttachmentPayload{
			MimeType: mimeType,
			Content:  content,
		})
	}

	return attachments
}

func sessionRecordToSummary(record sessionRecord) (SessionSummary, error) {
	var lastMessage map[string]any
	if record.LastMessageJSON.Valid && strings.TrimSpace(record.LastMessageJSON.String) != "" {
		decoded, err := decodeJSONObject(record.LastMessageJSON.String)
		if err != nil {
			return SessionSummary{}, err
		}
		lastMessage = decoded
	}

	return SessionSummary{
		Key:           record.ID,
		FriendlyID:    record.FriendlyID,
		Title:         nullStringValue(record.Title),
		DerivedTitle:  nullStringValue(record.DerivedTitle),
		Label:         nullStringValue(record.Label),
		IsPinned:      record.IsPinned,
		UpdatedAt:     record.UpdatedAt,
		LastMessage:   lastMessage,
		TotalTokens:   record.TotalTokens,
		ContextTokens: record.ContextTokens,
	}, nil
}

func decodeJSONObject(raw string) (map[string]any, error) {
	var value map[string]any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, fmt.Errorf("decode json object: %w", err)
	}
	return value, nil
}

func normalizeSessionLabel(value string) string {
	return strings.TrimSpace(value)
}

func nullableString(value string) sql.NullString {
	if strings.TrimSpace(value) == "" {
		return sql.NullString{}
	}
	return sql.NullString{
		String: strings.TrimSpace(value),
		Valid:  true,
	}
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func newFriendlyID() string {
	return newID()[:8]
}

func encodeMessageContent(value any) (string, error) {
	content, ok := value.([]any)
	if ok {
		bytes, err := json.Marshal(content)
		if err != nil {
			return "", fmt.Errorf("encode message content: %w", err)
		}
		return string(bytes), nil
	}

	bytes, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("encode message content: %w", err)
	}
	return string(bytes), nil
}

func nullableJSONObject(value any) sql.NullString {
	if value == nil {
		return sql.NullString{}
	}
	bytes, err := json.Marshal(value)
	if err != nil || len(bytes) == 0 || string(bytes) == "null" {
		return sql.NullString{}
	}
	return sql.NullString{String: string(bytes), Valid: true}
}

func stringValueFromMap(value map[string]any, key string) string {
	raw, ok := value[key]
	if !ok {
		return ""
	}
	text, ok := raw.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func boolValueFromMap(value map[string]any, key string) bool {
	raw, ok := value[key]
	if !ok {
		return false
	}
	enabled, ok := raw.(bool)
	return ok && enabled
}

func mapValueFromMap(value map[string]any, key string) map[string]any {
	raw, ok := value[key]
	if !ok {
		return nil
	}
	mapped, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	return mapped
}

func nullableInt64FromMap(value map[string]any, key string) sql.NullInt64 {
	parsed := int64Value(value[key])
	if parsed == 0 {
		switch typed := value[key].(type) {
		case int:
			if typed == 0 {
				return sql.NullInt64{Int64: 0, Valid: true}
			}
		case int64:
			if typed == 0 {
				return sql.NullInt64{Int64: 0, Valid: true}
			}
		case float64:
			if typed == 0 {
				return sql.NullInt64{Int64: 0, Valid: true}
			}
		case json.Number:
			if typed.String() == "0" {
				return sql.NullInt64{Int64: 0, Valid: true}
			}
		default:
			return sql.NullInt64{}
		}
	}
	return sql.NullInt64{Int64: parsed, Valid: true}
}

func boolAsInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func messageIDFromMap(message map[string]any) string {
	if id := stringValueFromMap(message, "id"); id != "" {
		return id
	}
	return newID()
}

func deriveTitleFromMessage(message map[string]any) string {
	if stringValueFromMap(message, "role") != "user" {
		return ""
	}
	for _, part := range contentPartsFromAny(message["content"]) {
		if strings.TrimSpace(part.Type) == "text" {
			return trimTitle(part.Text)
		}
	}
	return ""
}

func trimTitle(value string) string {
	normalized := strings.Join(strings.Fields(value), " ")
	if len(normalized) <= 48 {
		return normalized
	}
	return strings.TrimSpace(normalized[:48])
}

func approximateMessageTokens(message map[string]any) int64 {
	text := textFromMessageMap(message)
	if text == "" {
		return 0
	}
	return int64(max(1, len(text)/4))
}

func textFromMessageMap(message map[string]any) string {
	return textFromContentParts(contentPartsFromAny(message["content"]))
}

func max(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
