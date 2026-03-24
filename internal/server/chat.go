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
	Key                string         `json:"key"`
	FriendlyID         string         `json:"friendlyId"`
	Title              string         `json:"title,omitempty"`
	DerivedTitle       string         `json:"derivedTitle,omitempty"`
	Label              string         `json:"label,omitempty"`
	IsPinned           bool           `json:"isPinned,omitempty"`
	UpdatedAt          int64          `json:"updatedAt,omitempty"`
	LastMessage        map[string]any `json:"lastMessage,omitempty"`
	TotalTokens        int64          `json:"totalTokens,omitempty"`
	ContextTokens      int64          `json:"contextTokens,omitempty"`
	ParentSessionKey   string         `json:"parentSessionKey,omitempty"`
	ParentFriendlyID   string         `json:"parentFriendlyId,omitempty"`
	ForkPointMessageID string         `json:"forkPointMessageId,omitempty"`
	ForkDepth          int64          `json:"forkDepth,omitempty"`
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
	ID                 string
	UserID             string
	FriendlyID         string
	Title              sql.NullString
	DerivedTitle       sql.NullString
	Label              sql.NullString
	IsPinned           bool
	UpdatedAt          int64
	LastMessageJSON    sql.NullString
	TotalTokens        int64
	ContextTokens      int64
	ParentSessionID    sql.NullString
	ParentFriendlyID   sql.NullString
	ForkPointMessageID sql.NullString
	ForkDepth          int64
}

type messageRecord struct {
	StorageID   string
	MessageID   string
	Role        string
	ContentJSON string
	MessageJSON string
	Timestamp   int64
	CreatedAt   int64
	Message     map[string]any
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
			context_tokens,
			parent_session_id,
			parent_friendly_id,
			fork_point_message_id,
			fork_depth
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
			context_tokens,
			fork_depth
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)
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

func (service *ChatService) ForkSession(
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

	forkIndex := findMessageRecordIndex(messageRecords, messageID)
	if forkIndex < 0 {
		return SessionSummary{}, fmt.Errorf("fork point message not found")
	}

	return service.createForkedSession(ctx, source, messageRecords[:forkIndex+1], strings.TrimSpace(messageID))
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

	forkPointMessageID := ""
	if messageIndex > 0 {
		forkPointMessageID = messageRecords[messageIndex-1].MessageID
	}

	return service.createForkedSession(ctx, source, messageRecords[:messageIndex], forkPointMessageID)
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

	forkPointMessageID := ""
	if messageIndex > 0 {
		forkPointMessageID = messageRecords[messageIndex-1].MessageID
	}

	forkedSession, err := service.createForkedSession(ctx, source, messageRecords[:messageIndex], forkPointMessageID)
	if err != nil {
		return SessionSummary{}, nil, err
	}

	return forkedSession, extractAttachmentPayloads(target.Message), nil
}

func (service *ChatService) appendMessage(
	ctx context.Context,
	session sessionRecord,
	message map[string]any,
	timestamp int64,
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
	if derivedTitle == "" {
		derivedTitle = deriveTitleFromMessage(message)
	}

	if _, err := service.db.ExecContext(ctx, `
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
			message_json,
			created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, messageIDFromMap(message), session.ID, stringValueFromMap(message, "role"), stringValueFromMap(message, "model"), stringValueFromMap(message, "modelName"), stringValueFromMap(message, "modelDescription"), contentJSON, stringValueFromMap(message, "toolCallId"), stringValueFromMap(message, "toolName"), nullableJSONObject(message["details"]), boolAsInt(boolValueFromMap(message, "isError")), timestamp, string(messageJSON), now); err != nil {
		return SessionSummary{}, fmt.Errorf("insert chat message: %w", err)
	}

	if _, err := service.db.ExecContext(ctx, `
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
			created_at
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

func (service *ChatService) createForkedSession(
	ctx context.Context,
	source sessionRecord,
	messageRecords []messageRecord,
	forkPointMessageID string,
) (SessionSummary, error) {
	now := time.Now().UnixMilli()
	sessionID := newID()
	friendlyID := newFriendlyID()

	derivedTitle := deriveTitleFromMessages(messageRecords)
	totalTokens := countMessageRecordTokens(messageRecords)
	var lastMessageJSON sql.NullString
	if len(messageRecords) > 0 {
		lastMessageJSON = nullableString(messageRecords[len(messageRecords)-1].MessageJSON)
	}

	transaction, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionSummary{}, fmt.Errorf("begin fork session tx: %w", err)
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
			context_tokens,
			parent_session_id,
			parent_friendly_id,
			fork_point_message_id,
			fork_depth
		)
		VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, sessionID, source.UserID, friendlyID, nullableString(derivedTitle), 0, now, now, lastMessageJSON, totalTokens, source.ContextTokens, source.ID, nullableString(source.FriendlyID), nullableString(forkPointMessageID), source.ForkDepth+1); err != nil {
		return SessionSummary{}, fmt.Errorf("create fork session: %w", err)
	}

	for _, messageRecord := range messageRecords {
		if _, err := transaction.ExecContext(ctx, `
			INSERT INTO chat_messages(
				id,
				session_id,
				role,
				content_json,
				timestamp,
				message_json,
				created_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, newID(), sessionID, messageRecord.Role, messageRecord.ContentJSON, messageRecord.Timestamp, messageRecord.MessageJSON, now); err != nil {
			return SessionSummary{}, fmt.Errorf("copy fork message: %w", err)
		}
	}

	if err := transaction.Commit(); err != nil {
		return SessionSummary{}, fmt.Errorf("commit fork session: %w", err)
	}

	return SessionSummary{
		Key:                sessionID,
		FriendlyID:         friendlyID,
		DerivedTitle:       derivedTitle,
		IsPinned:           false,
		UpdatedAt:          now,
		LastMessage:        lastMessageFromRecords(messageRecords),
		TotalTokens:        totalTokens,
		ContextTokens:      source.ContextTokens,
		ParentSessionKey:   source.ID,
		ParentFriendlyID:   source.FriendlyID,
		ForkPointMessageID: forkPointMessageID,
		ForkDepth:          source.ForkDepth + 1,
	}, nil
}

func (service *ChatService) findSessionByFriendlyID(
	ctx context.Context,
	userID string,
	friendlyID string,
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
			context_tokens,
			parent_session_id,
			parent_friendly_id,
			fork_point_message_id,
			fork_depth
		FROM chat_sessions
		WHERE user_id = ? AND friendly_id = ?
	`, userID, strings.TrimSpace(friendlyID)).Scan(
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
		&record.ParentSessionID,
		&record.ParentFriendlyID,
		&record.ForkPointMessageID,
		&record.ForkDepth,
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
		&record.ParentSessionID,
		&record.ParentFriendlyID,
		&record.ForkPointMessageID,
		&record.ForkDepth,
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

func countMessageRecordTokens(records []messageRecord) int64 {
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
	content, ok := message["content"].([]any)
	if !ok {
		return nil
	}

	attachments := make([]AttachmentPayload, 0)
	for _, item := range content {
		part, ok := item.(map[string]any)
		if !ok || strings.TrimSpace(stringValueFromMap(part, "type")) != "image" {
			continue
		}
		source, ok := part["source"].(map[string]any)
		if !ok || strings.TrimSpace(stringValueFromMap(source, "type")) != "base64" {
			continue
		}
		mimeType := strings.TrimSpace(stringValueFromMap(source, "media_type"))
		content := strings.TrimSpace(stringValueFromMap(source, "data"))
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
		Key:                record.ID,
		FriendlyID:         record.FriendlyID,
		Title:              nullStringValue(record.Title),
		DerivedTitle:       nullStringValue(record.DerivedTitle),
		Label:              nullStringValue(record.Label),
		IsPinned:           record.IsPinned,
		UpdatedAt:          record.UpdatedAt,
		LastMessage:        lastMessage,
		TotalTokens:        record.TotalTokens,
		ContextTokens:      record.ContextTokens,
		ParentSessionKey:   nullStringValue(record.ParentSessionID),
		ParentFriendlyID:   nullStringValue(record.ParentFriendlyID),
		ForkPointMessageID: nullStringValue(record.ForkPointMessageID),
		ForkDepth:          record.ForkDepth,
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
	content, ok := message["content"].([]map[string]any)
	if ok {
		for _, part := range content {
			if strings.TrimSpace(stringValueFromMap(part, "type")) == "text" {
				return trimTitle(stringValueFromMap(part, "text"))
			}
		}
	}

	rawContent, ok := message["content"].([]any)
	if !ok {
		return ""
	}
	for _, item := range rawContent {
		part, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if strings.TrimSpace(stringValueFromMap(part, "type")) == "text" {
			return trimTitle(stringValueFromMap(part, "text"))
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
	rawContent, ok := message["content"].([]any)
	if !ok {
		return ""
	}
	parts := make([]string, 0, len(rawContent))
	for _, rawPart := range rawContent {
		part, ok := rawPart.(map[string]any)
		if !ok {
			continue
		}
		if strings.TrimSpace(stringValueFromMap(part, "type")) != "text" {
			continue
		}
		text := strings.TrimSpace(stringValueFromMap(part, "text"))
		if text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, " ")
}

func max(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
