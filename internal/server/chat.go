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
	UpdatedAt          int64
	LastMessageJSON    sql.NullString
	TotalTokens        int64
	ContextTokens      int64
	ParentSessionID    sql.NullString
	ParentFriendlyID   sql.NullString
	ForkPointMessageID sql.NullString
	ForkDepth          int64
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
		ORDER BY updated_at DESC, created_at DESC, id DESC
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
			updated_at,
			created_at,
			total_tokens,
			context_tokens,
			fork_depth
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)
	`, sessionID, userID, friendlyID, nullableString(normalizedLabel), nullableString(normalizedLabel), nullableString(normalizedLabel), now, now, defaultContextTokens); err != nil {
		return SessionSummary{}, fmt.Errorf("create session: %w", err)
	}

	return SessionSummary{
		Key:           sessionID,
		FriendlyID:    friendlyID,
		Title:         normalizedLabel,
		DerivedTitle:  normalizedLabel,
		Label:         normalizedLabel,
		UpdatedAt:     now,
		TotalTokens:   0,
		ContextTokens: defaultContextTokens,
	}, nil
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

	rows, err := service.db.QueryContext(ctx, `
		SELECT message_json
		FROM chat_messages
		WHERE session_id = ?
		ORDER BY timestamp ASC, created_at ASC, id ASC
	`, record.ID)
	if err != nil {
		return HistoryPayload{}, fmt.Errorf("list messages: %w", err)
	}
	defer rows.Close()

	messages := make([]map[string]any, 0)
	for rows.Next() {
		var messageJSON string
		if err := rows.Scan(&messageJSON); err != nil {
			return HistoryPayload{}, fmt.Errorf("scan message: %w", err)
		}
		message, err := decodeJSONObject(messageJSON)
		if err != nil {
			return HistoryPayload{}, err
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return HistoryPayload{}, fmt.Errorf("iterate messages: %w", err)
	}

	return HistoryPayload{
		SessionKey: record.ID,
		SessionID:  record.FriendlyID,
		Messages:   messages,
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
