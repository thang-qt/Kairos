package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

// Retry is explicit: the caller accepts that already-executed tools may run again.
// It replaces this attempt's checkpoints while retaining the same visible turn.
func (service *AgentRuntime) RetryRun(ctx context.Context, userID, friendlyID, runID, key string, expected *int64) (SubmitTurnResult, error) {
	if strings.TrimSpace(key) == "" {
		return SubmitTurnResult{}, errors.New("retry requires an idempotencyKey")
	}
	service.conversations.commandMu.Lock()
	defer service.conversations.commandMu.Unlock()
	session, err := service.conversations.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return SubmitTurnResult{}, err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return SubmitTurnResult{}, err
	}
	defer tx.Rollback()
	var result SubmitTurnResult
	result.RunID = runID
	result.SessionKey = session.ID
	var status string
	var invalidated int
	var revision int64
	if err := tx.QueryRowContext(ctx, `SELECT status,COALESCE(assistant_message_id,id),COALESCE(user_message_id,''),invalidated,revision FROM chat_runs WHERE id=? AND session_id=? AND user_id=?`, runID, session.ID, userID).Scan(&status, &result.AssistantTurnID, &result.UserTurnID, &invalidated, &result.Revision); err != nil {
		return result, errChatSessionNotFound
	}
	var repeated int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_retry_commands WHERE run_id=? AND command_key=?`, runID, key).Scan(&repeated); err != nil {
		return result, err
	}
	if repeated > 0 {
		return result, nil
	}
	if err := tx.QueryRowContext(ctx, `SELECT revision FROM chat_sessions WHERE id=?`, session.ID).Scan(&revision); err != nil {
		return result, err
	}
	if expected != nil && *expected != revision {
		return result, errConversationConflict
	}
	var sourceUserID string
	if err := tx.QueryRowContext(ctx, `SELECT json_extract(m.message_json,'$.id') FROM chat_messages m JOIN chat_runs r ON r.id=? WHERE m.session_id=? AND m.role='user' AND (json_extract(m.message_json,'$.id')=r.user_message_id OR (r.user_message_id IS NULL AND m.timestamp=r.started_at)) LIMIT 1`, runID, session.ID).Scan(&sourceUserID); err != nil {
		return result, errConversationConflict
	}
	result.UserTurnID = sourceUserID
	if invalidated != 0 || (status != "error" && status != "interrupted" && status != "aborted") {
		return result, errConversationConflict
	}
	// Only the last response can be replaced in a linear conversation.
	var newer int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_runs WHERE session_id=? AND invalidated=0 AND started_at>(SELECT started_at FROM chat_runs WHERE id=?)`, session.ID, runID).Scan(&newer); err != nil {
		return result, err
	}
	if newer > 0 {
		return result, errConversationConflict
	}
	revision++
	result.Revision = revision
	if _, err := tx.ExecContext(ctx, `UPDATE chat_sessions SET revision=? WHERE id=?`, revision, session.ID); err != nil {
		return result, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM chat_messages WHERE session_id=? AND run_id=?`, session.ID, runID); err != nil {
		return result, err
	}
	remaining, err := service.conversations.listMessageRecordsExec(ctx, tx, session.ID)
	if err != nil {
		return result, err
	}
	var lastMessage any
	if len(remaining) > 0 {
		lastMessage = remaining[len(remaining)-1].Message
	}
	if _, err := tx.ExecContext(ctx, `UPDATE chat_sessions SET total_tokens=?,last_message_json=? WHERE id=?`, countMessageRecordTokens(remaining), nullableJSONObject(lastMessage), session.ID); err != nil {
		return result, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM chat_run_steps WHERE run_id=?`, runID); err != nil {
		return result, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE chat_runs SET user_message_id=?,status='queued',revision=?,lease_token='',lease_until=0,completed_at=NULL,error_message=NULL,turn_json=NULL WHERE id=?`, sourceUserID, revision, runID); err != nil {
		return result, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO chat_jobs(run_id,available_at) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET available_at=excluded.available_at`, runID, time.Now().UnixMilli()); err != nil {
		return result, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO chat_retry_commands(run_id,command_key) VALUES(?,?)`, runID, key); err != nil {
		return result, err
	}
	if err := service.refreshTurnExec(ctx, tx, runID, "delta"); err != nil {
		return result, err
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	service.notifyQueue()
	return result, nil
}

func (app *App) handleRetryRun(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}
	var payload struct {
		IdempotencyKey   string `json:"idempotencyKey"`
		ExpectedRevision *int64 `json:"expectedRevision,omitempty"`
	}
	if err := decodeJSON(request, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	result, err := app.runtime.RetryRun(request.Context(), user.ID, request.PathValue("friendlyId"), request.PathValue("runId"), payload.IdempotencyKey, payload.ExpectedRevision)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errConversationConflict) {
			status = http.StatusConflict
		}
		if errors.Is(err, errChatSessionNotFound) {
			status = http.StatusNotFound
		}
		writeError(writer, status, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, result)
}
