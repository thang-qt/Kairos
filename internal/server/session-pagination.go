package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
)

var errInvalidSessionPage = errors.New("invalid session pagination")

type sessionPageCursor struct {
	Pinned  int    `json:"p"`
	Updated int64  `json:"u"`
	Created int64  `json:"c"`
	ID      string `json:"i"`
}

func (service *ConversationService) ListSessionPage(ctx context.Context, userID string, limit int, cursor string) (sessionsResponse, error) {
	result := sessionsResponse{Sessions: []SessionSummary{}}
	if limit < 1 || limit > 100 {
		return result, errInvalidSessionPage
	}
	where := ""
	args := []any{userID}
	if cursor != "" {
		if len(cursor) > 1024 {
			return result, errInvalidSessionPage
		}
		raw, err := base64.RawURLEncoding.DecodeString(cursor)
		if err != nil {
			return result, errInvalidSessionPage
		}
		var boundary sessionPageCursor
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&boundary) != nil || boundary.ID == "" || (boundary.Pinned != 0 && boundary.Pinned != 1) {
			return result, errInvalidSessionPage
		}
		where = " AND (is_pinned,updated_at,created_at,id) < (?,?,?,?)"
		args = append(args, boundary.Pinned, boundary.Updated, boundary.Created, boundary.ID)
	}
	args = append(args, limit+1)
	rows, err := service.db.QueryContext(ctx, `SELECT id,user_id,friendly_id,title,derived_title,label,is_pinned,updated_at,NULL AS last_message_json,total_tokens,context_tokens,conversation_settings_json,revision,created_at FROM chat_sessions WHERE user_id=?`+where+` ORDER BY is_pinned DESC,updated_at DESC,created_at DESC,id DESC LIMIT ?`, args...)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	var last sessionPageCursor
	for rows.Next() {
		var created int64
		record, err := scanSessionRecord(rows, &created)
		if err != nil {
			return result, err
		}
		if len(result.Sessions) == limit {
			raw, _ := json.Marshal(last)
			result.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
			break
		}
		summary, err := sessionRecordToSummary(record)
		if err != nil {
			return result, err
		}
		result.Sessions = append(result.Sessions, summary)
		last = sessionPageCursor{Pinned: boolAsInt(record.IsPinned), Updated: record.UpdatedAt, Created: created, ID: record.ID}
	}
	return result, rows.Err()
}
