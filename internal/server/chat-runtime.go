package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"time"
)

var errConversationConflict = errors.New("conversation changed or already has an active run; reload and retry")

const workerLease = 30 * time.Second

func (service *ChatRunService) StartWorkers() {
	service.workerOnce.Do(func() {
		ctx, cancel := context.WithCancel(context.Background())
		service.workerCancel = cancel
		service.workerContext = ctx
		service.workerWG.Add(1)
		go func() {
			defer service.workerWG.Done()
			ticker := time.NewTicker(100 * time.Millisecond)
			defer ticker.Stop()
			for {
				if err := service.dispatchJobs(ctx); err != nil && ctx.Err() == nil {
					log.Printf("kairos: queue: %v", err)
				}
				select {
				case <-ctx.Done():
					return
				case <-service.wake:
				case <-ticker.C:
				}
			}
		}()
	})
}

func (service *ChatRunService) Close() {
	if service.workerCancel != nil {
		service.workerCancel()
	}
	service.runMu.Lock()
	for _, cancel := range service.runCancels {
		cancel()
	}
	service.runMu.Unlock()
	service.workerWG.Wait()
}

func (service *ChatRunService) dispatchJobs(ctx context.Context) error {
	now := time.Now().UnixMilli()
	// Never replay uncertain model/tool execution automatically.
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id FROM chat_runs WHERE status IN ('preparing','running') AND lease_until < ?`, now)
	if err != nil {
		return err
	}
	var expired []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		expired = append(expired, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, id := range expired {
		if _, err := tx.ExecContext(ctx, `UPDATE chat_runs SET status='interrupted', completed_at=?, error_message='Execution interrupted; retry explicitly to avoid repeating tool effects', lease_token='' WHERE id=?`, now, id); err != nil {
			return err
		}
		if err := service.refreshTurnExec(ctx, tx, id, "error"); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM chat_jobs WHERE run_id=?`, id); err != nil {
			return err
		}
	}
	var record runRecord
	var requestJSON, friendlyID string
	err = tx.QueryRowContext(ctx, `SELECT r.id,r.user_id,r.session_id,r.model,r.assistant_message_id,r.revision,r.request_json,s.friendly_id FROM chat_jobs j JOIN chat_runs r ON r.id=j.run_id JOIN chat_sessions s ON s.id=r.session_id WHERE r.status='queued' AND r.invalidated=0 AND r.revision=s.revision AND j.available_at<=? ORDER BY j.available_at,r.created_at LIMIT 1`, now).Scan(&record.ID, &record.UserID, &record.SessionID, &record.Model, &record.AssistantMessageID, &record.Revision, &requestJSON, &friendlyID)
	if errors.Is(err, sql.ErrNoRows) {
		return tx.Commit()
	}
	if err != nil {
		return err
	}
	record.LeaseToken = newID()
	record.Status = "preparing"
	if _, err := tx.ExecContext(ctx, `UPDATE chat_runs SET status='preparing',lease_token=?,lease_until=? WHERE id=? AND status='queued'`, record.LeaseToken, now+workerLease.Milliseconds(), record.ID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE chat_jobs SET attempts=attempts+1 WHERE run_id=?`, record.ID); err != nil {
		return err
	}
	if err := service.refreshTurnExec(ctx, tx, record.ID, "delta"); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	var input SendMessageInput
	if err := json.Unmarshal([]byte(requestJSON), &input); err != nil {
		service.finishOwnedRun(record, "error", err)
		return nil
	}
	input.FriendlyID = friendlyID
	session, err := service.chat.findSessionByFriendlyID(ctx, record.UserID, friendlyID)
	if err != nil {
		return err
	}
	history, err := service.chat.getTranscript(ctx, record.UserID, friendlyID)
	if err != nil {
		service.finishOwnedRun(record, "error", err)
		return nil
	}
	log.Printf("kairos: stage=worker_claim run=%s revision=%d", record.ID, record.Revision)
	service.runAsync(record, session, history.Messages, input)
	return nil
}

func (service *ChatRunService) guardRunExec(ctx context.Context, exec sqlExecutor, record runRecord) (bool, error) {
	result, err := exec.ExecContext(ctx, `UPDATE chat_runs SET lease_until=? WHERE id=? AND status IN ('preparing','running') AND invalidated=0 AND revision=(SELECT revision FROM chat_sessions WHERE id=chat_runs.session_id) AND lease_token=? AND lease_until>?`, time.Now().Add(workerLease).UnixMilli(), record.ID, record.LeaseToken, time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	return n > 0, err
}

// refreshTurnExec is the sole projection writer. Its event is committed with its checkpoint.
func (service *ChatRunService) refreshTurnExec(ctx context.Context, exec sqlExecutor, runID, state string) error {
	var sessionID, turnID, status, errorMessage string
	var revision, started int64
	var invalidated int
	if err := exec.QueryRowContext(ctx, `SELECT session_id,COALESCE(assistant_message_id,id),status,COALESCE(error_message,''),revision,started_at,invalidated FROM chat_runs WHERE id=?`, runID).Scan(&sessionID, &turnID, &status, &errorMessage, &revision, &started, &invalidated); err != nil {
		return err
	}
	if invalidated != 0 {
		return nil
	}
	rows, err := exec.QueryContext(ctx, `SELECT message_json FROM chat_run_steps WHERE run_id=? ORDER BY timestamp,step_id`, runID)
	if err != nil {
		return err
	}
	steps := []map[string]any{}
	content := []any{}
	var latest map[string]any
	for rows.Next() {
		var encoded string
		if err := rows.Scan(&encoded); err != nil {
			rows.Close()
			return err
		}
		var message map[string]any
		if err := json.Unmarshal([]byte(encoded), &message); err != nil {
			rows.Close()
			return err
		}
		steps = append(steps, message)
		if stringValueFromMap(message, "role") == "assistant" {
			latest = message
			if parts, ok := message["content"].([]any); ok {
				content = append(content, parts...)
			}
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	turn := map[string]any{"id": turnID, "role": "assistant", "runId": runID, "status": status, "revision": revision, "timestamp": started, "content": content, "steps": steps}
	if latest != nil {
		for _, key := range []string{"model", "modelName", "modelDescription", "details"} {
			if value, ok := latest[key]; ok {
				turn[key] = value
			}
		}
	}
	if errorMessage != "" {
		turn["error"] = errorMessage
	}
	encoded, err := json.Marshal(turn)
	if err != nil {
		return err
	}
	if _, err := exec.ExecContext(ctx, `UPDATE chat_runs SET turn_json=? WHERE id=?`, string(encoded), runID); err != nil {
		return err
	}
	event := ChatEvent{RunID: runID, SessionKey: sessionID, Revision: revision, TurnID: turnID, State: state, Error: errorMessage, Message: turn}
	return insertChatEventExec(ctx, exec, event)
}

func insertChatEventExec(ctx context.Context, exec sqlExecutor, event ChatEvent) error {
	encoded, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = exec.ExecContext(ctx, `INSERT INTO chat_events(session_id,revision,event_json,created_at) VALUES(?,?,?,?)`, event.SessionKey, event.Revision, string(encoded), time.Now().UnixMilli())
	return err
}

func checkpointStepExec(ctx context.Context, exec sqlExecutor, runID string, message map[string]any) error {
	encoded, err := json.Marshal(message)
	if err != nil {
		return err
	}
	_, err = exec.ExecContext(ctx, `INSERT INTO chat_run_steps(run_id,step_id,message_json,timestamp) VALUES(?,?,?,?) ON CONFLICT(run_id,step_id) DO UPDATE SET message_json=excluded.message_json`, runID, messageIDFromMap(message), string(encoded), int64Value(message["timestamp"]))
	return err
}

func (service *ChatRunService) finishOwnedRun(record runRecord, status string, runErr error) {
	ctx := context.Background()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		log.Printf("kairos: terminal tx: %v", err)
		return
	}
	defer tx.Rollback()
	valid, err := service.guardRunExec(ctx, tx, record)
	if err != nil || !valid {
		return
	}
	message := ""
	if runErr != nil {
		message = runErr.Error()
	}
	if _, err = tx.ExecContext(ctx, `UPDATE chat_runs SET status=?,completed_at=?,error_message=?,lease_token='' WHERE id=?`, status, time.Now().UnixMilli(), nullableString(message), record.ID); err != nil {
		return
	}
	if err = service.refreshTurnExec(ctx, tx, record.ID, "error"); err != nil {
		return
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM chat_jobs WHERE run_id=?`, record.ID); err != nil {
		return
	}
	if err = tx.Commit(); err != nil {
		log.Printf("kairos: terminal commit: %v", err)
	}
}

func (service *ChatService) GetHistory(ctx context.Context, userID, friendlyID string) (HistoryPayload, error) {
	session, err := service.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return HistoryPayload{}, err
	}
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return HistoryPayload{}, err
	}
	defer tx.Rollback()
	history := HistoryPayload{SessionKey: session.ID, SessionID: friendlyID, Messages: []map[string]any{}, ActiveRunIDs: []string{}}
	if err := tx.QueryRowContext(ctx, `SELECT revision FROM chat_sessions WHERE id=?`, session.ID).Scan(&history.Revision); err != nil {
		return history, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(sequence),0) FROM chat_events WHERE session_id=?`, session.ID).Scan(&history.Cursor); err != nil {
		return history, err
	}
	records, err := service.listMessageRecordsExec(ctx, tx, session.ID)
	if err != nil {
		return history, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,COALESCE(turn_json,''),status,COALESCE(assistant_message_id,id),started_at FROM chat_runs WHERE session_id=? AND invalidated=0 ORDER BY started_at,id`, session.ID)
	if err != nil {
		return history, err
	}
	turns := map[string]map[string]any{}
	ordered := []string{}
	for rows.Next() {
		var id, encoded, status, turnID string
		var started int64
		if err := rows.Scan(&id, &encoded, &status, &turnID, &started); err != nil {
			rows.Close()
			return history, err
		}
		if status == "queued" || status == "preparing" || status == "running" {
			history.ActiveRunIDs = append(history.ActiveRunIDs, id)
		}
		if encoded != "" {
			var turn map[string]any
			if err := json.Unmarshal([]byte(encoded), &turn); err != nil {
				rows.Close()
				return history, err
			}
			turns[id] = turn
		} else {
			turns[id] = map[string]any{"id": turnID, "role": "assistant", "runId": id, "status": status, "timestamp": started, "content": []any{}, "steps": []any{}}
		}
		ordered = append(ordered, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return history, err
	}
	rows.Close()
	// Backfill the same projection for historical rounds. Unknown legacy messages remain readable.
	historical := map[string][]map[string]any{}
	for _, r := range records {
		id := stringValueFromMap(r.Message, "runId")
		if id != "" {
			historical[id] = append(historical[id], r.Message)
		}
	}
	for id, messages := range historical {
		turn, ok := turns[id]
		if !ok {
			turn = map[string]any{"id": messageIDFromMap(messages[0]), "role": "assistant", "runId": id, "status": "completed", "timestamp": messages[0]["timestamp"]}
			turns[id] = turn
		}
		if parts, ok := turn["content"].([]any); ok && len(parts) > 0 {
			continue
		}
		content := []any{}
		for _, m := range messages {
			if stringValueFromMap(m, "role") == "assistant" {
				for _, part := range contentPartsToMaps(contentPartsFromAny(m["content"])) {
					content = append(content, part)
				}
				for _, key := range []string{"model", "modelName", "modelDescription", "details"} {
					if v, ok := m[key]; ok {
						turn[key] = v
					}
				}
			}
		}
		turn["content"] = content
		turn["steps"] = messages
	}
	emitted := map[string]bool{}
	for _, r := range records {
		id := stringValueFromMap(r.Message, "runId")
		if id == "" {
			history.Messages = append(history.Messages, r.Message)
			continue
		}
		if turn, ok := turns[id]; ok && !emitted[id] {
			history.Messages = append(history.Messages, turn)
			emitted[id] = true
		}
	}
	for _, id := range ordered {
		if !emitted[id] {
			history.Messages = append(history.Messages, turns[id])
		}
	}
	// Stable timestamps give queued placeholders their correct position after the user turn.
	sortTurns(history.Messages)
	return history, tx.Commit()
}

func (service *ChatRunService) readEvents(ctx context.Context, sessionID string, after int64) ([]ChatEvent, error) {
	rows, err := service.db.QueryContext(ctx, `SELECT sequence,event_json FROM chat_events WHERE session_id=? AND sequence>? AND revision=(SELECT revision FROM chat_sessions WHERE id=?) ORDER BY sequence LIMIT 256`, sessionID, after, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []ChatEvent{}
	for rows.Next() {
		var cursor int64
		var encoded string
		if err := rows.Scan(&cursor, &encoded); err != nil {
			return nil, err
		}
		var event ChatEvent
		if err := json.Unmarshal([]byte(encoded), &event); err != nil {
			return nil, err
		}
		event.Cursor = cursor
		events = append(events, event)
	}
	return events, rows.Err()
}

func (service *ChatRunService) notifyQueue() {
	select {
	case service.wake <- struct{}{}:
	default:
	}
}

func conflictIfNoRows(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return errConversationConflict
	}
	return nil
}

func invalidationExec(ctx context.Context, exec sqlExecutor, sessionID string) error {
	_, err := exec.ExecContext(ctx, `UPDATE chat_runs SET invalidated=1,status=CASE WHEN status IN ('queued','preparing','running') THEN 'aborted' ELSE status END,lease_token='' WHERE session_id=? AND status IN ('queued','preparing','running')`, sessionID)
	if err != nil {
		return fmt.Errorf("invalidate runs: %w", err)
	}
	_, err = exec.ExecContext(ctx, `DELETE FROM chat_jobs WHERE run_id IN (SELECT id FROM chat_runs WHERE session_id=? AND invalidated=1)`, sessionID)
	return err
}

func sortTurns(turns []map[string]any) {
	sort.SliceStable(turns, func(i, j int) bool { return int64Value(turns[i]["timestamp"]) < int64Value(turns[j]["timestamp"]) })
}
