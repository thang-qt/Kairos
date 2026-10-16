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

// Full projections establish boundary and recovery snapshots.
type runProjection struct {
	turn         map[string]any
	sessionID    string
	previousJSON string
}

// Load full state at boundaries and for recovery, never for each text checkpoint.
func (service *AgentRuntime) loadRunProjection(ctx context.Context, exec sqlExecutor, runID string) (*runProjection, error) {
	var sessionID, turnID, status, errorMessage, previousJSON string
	var revision, started int64
	var invalidated, hasRequest int
	if err := exec.QueryRowContext(ctx, `SELECT session_id,COALESCE(assistant_message_id,id),status,COALESCE(error_message,''),revision,started_at,invalidated,(request_json IS NOT NULL AND request_json!=''),COALESCE(turn_json,'') FROM chat_runs WHERE id=?`, runID).Scan(&sessionID, &turnID, &status, &errorMessage, &revision, &started, &invalidated, &hasRequest, &previousJSON); err != nil {
		return nil, err
	}
	if invalidated != 0 {
		return nil, nil
	}
	rows, err := exec.QueryContext(ctx, `SELECT message_json FROM chat_run_steps WHERE run_id=? ORDER BY timestamp,step_id`, runID)
	if err != nil {
		return nil, err
	}
	steps := []map[string]any{}
	content := []any{}
	var latest map[string]any
	for rows.Next() {
		var encoded string
		if err := rows.Scan(&encoded); err != nil {
			rows.Close()
			return nil, err
		}
		var message map[string]any
		if err := json.Unmarshal([]byte(encoded), &message); err != nil {
			rows.Close()
			return nil, err
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
		return nil, err
	}
	rows.Close()
	if status == "aborted" || status == "interrupted" || status == "error" {
		results := map[string]bool{}
		for _, step := range steps {
			if stringValueFromMap(step, "role") == "toolResult" {
				results[stringValueFromMap(step, "toolCallId")] = true
			}
		}
		for _, value := range content {
			if part, ok := value.(map[string]any); ok && stringValueFromMap(part, "type") == "toolCall" && !results[stringValueFromMap(part, "id")] {
				part["status"] = status
			}
		}
	}
	turn := map[string]any{"id": turnID, "role": "assistant", "runId": runID, "status": status, "revision": revision, "timestamp": started, "content": content, "steps": steps}
	canRetry := hasRequest != 0 && (status == "error" || status == "aborted" || status == "interrupted")
	if canRetry {
		var newer int
		if err := exec.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_runs WHERE session_id=? AND invalidated=0 AND started_at>?`, sessionID, started).Scan(&newer); err != nil {
			return nil, err
		}
		var users int
		if err := exec.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_messages m JOIN chat_runs r ON r.id=? WHERE m.session_id=? AND m.role='user' AND (json_extract(m.message_json,'$.id')=r.user_message_id OR (r.user_message_id IS NULL AND m.timestamp=r.started_at))`, runID, sessionID).Scan(&users); err != nil {
			return nil, err
		}
		canRetry = newer == 0 && users > 0
	}
	turn["canRetry"] = canRetry
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
	return &runProjection{turn: turn, sessionID: sessionID, previousJSON: previousJSON}, nil
}

func (service *AgentRuntime) refreshTurnExec(ctx context.Context, exec sqlExecutor, runID, state string) error {
	if err := service.materializeRunCheckpoint(ctx, exec, runID); err != nil {
		return err
	}
	projection, err := service.loadRunProjection(ctx, exec, runID)
	if err != nil || projection == nil {
		return err
	}
	turn, sessionID, previousJSON := projection.turn, projection.sessionID, projection.previousJSON
	turnID := stringValueFromMap(turn, "id")
	revision := int64Value(turn["revision"])
	errorMessage := stringValueFromMap(turn, "error")
	encoded, err := json.Marshal(turn)
	if err != nil {
		return err
	}
	if _, err := exec.ExecContext(ctx, `UPDATE chat_runs SET turn_json=?,turn_dirty=0 WHERE id=?`, string(encoded), runID); err != nil {
		return err
	}
	event := ConversationEvent{RunID: runID, SessionKey: sessionID, Revision: revision, TurnID: turnID, State: state, Error: errorMessage, Message: turn}
	if state == "delta" && previousJSON != "" {
		var previous, next map[string]any
		if json.Unmarshal([]byte(previousJSON), &previous) == nil && json.Unmarshal(encoded, &next) == nil {
			event.TurnPatch = diffTurn(previous, next)
			if len(event.TurnPatch) == 0 {
				return nil
			}
			event.Message = nil
		}
	}

	if err := insertChatEventExec(ctx, exec, event); err != nil {
		return err
	}
	return updateRunCheckpointCursor(ctx, exec, runID, sessionID)
}

func insertChatEventExec(ctx context.Context, exec sqlExecutor, event ConversationEvent) error {
	encoded, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = exec.ExecContext(ctx, `INSERT INTO chat_events(session_id,revision,event_json,created_at) VALUES(?,?,?,?)`, event.SessionKey, event.Revision, string(encoded), time.Now().UnixMilli())
	if err == nil {
		if tx, ok := exec.(*conversationTransaction); ok {
			tx.recordEvent(event.SessionKey)
		}
	}
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

func (service *AgentRuntime) finishOwnedRun(record executionRecord, status string, runErr error) {
	ctx := context.Background()
	tx, err := service.beginEventTx(ctx, nil)
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
	} else {
		log.Printf("kairos: stage=event_commit run=%s state=%s", record.ID, status)
	}
}

func (service *ConversationService) GetHistory(ctx context.Context, userID, friendlyID string) (HistoryPayload, error) {
	session, err := service.findSessionByFriendlyID(ctx, userID, friendlyID)
	if err != nil {
		return HistoryPayload{}, err
	}
	tx, err := service.beginEventTx(ctx, nil)
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
	legacyRuns := map[string]bool{}
	legacyAssistants := map[string]int{}
	legacyUserTimes := map[int64]bool{}
	var latestLegacyAssistant int64
	for index, record := range records {
		if id := stringValueFromMap(record.Message, "runId"); id != "" {
			legacyRuns[id] = true
		}
		if record.Role == "assistant" {
			legacyAssistants[record.MessageID] = index
			latestLegacyAssistant = maxInt64(latestLegacyAssistant, record.Timestamp)
		}
		if record.Role == "user" {
			legacyUserTimes[record.Timestamp] = true
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,COALESCE(turn_json,''),status,COALESCE(assistant_message_id,id),started_at,(request_json IS NOT NULL AND request_json!=''),COALESCE(error_message,''),turn_dirty FROM chat_runs WHERE session_id=? AND invalidated=0 ORDER BY started_at,id`, session.ID)
	if err != nil {
		return history, err
	}
	turns := map[string]map[string]any{}
	dirtyRuns := []string{}
	ordered := []string{}
	for rows.Next() {
		var id, encoded, status, turnID, errorMessage string
		var hasRequest, dirty int
		var started int64
		if err := rows.Scan(&id, &encoded, &status, &turnID, &started, &hasRequest, &errorMessage, &dirty); err != nil {
			rows.Close()
			return history, err
		}
		// Pre-refactor truncation left orphan run records. Do not resurrect an
		// assistant turn unless the surviving history supplies lineage or its user.
		if encoded == "" && !legacyRuns[id] {
			if index, exists := legacyAssistants[turnID]; exists {
				records[index].Message["status"] = status
				records[index].Message["canRetry"] = false
				continue
			}
			if status == "completed" || !legacyUserTimes[started] || latestLegacyAssistant >= started {
				continue
			}
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
		if hasRequest == 0 {
			turns[id]["canRetry"] = false
		}
		if errorMessage != "" {
			turns[id]["error"] = errorMessage
		}
		ordered = append(ordered, id)
		if dirty != 0 {
			dirtyRuns = append(dirtyRuns, id)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return history, err
	}
	rows.Close()
	for _, id := range dirtyRuns {
		turn, err := (&AgentRuntime{}).replayRunCheckpoint(ctx, tx, id)
		if err != nil {
			return history, err
		}
		turns[id] = turn
	}
	// Backfill the same projection for historical rounds. Unknown legacy messages remain readable.
	historical := map[string][]map[string]any{}
	for _, r := range records {
		id := stringValueFromMap(r.Message, "runId")
		if id != "" {
			historical[id] = append(historical[id], r.Message)
		}
	}
	for id, messages := range historical {
		if len(messages) == 1 && messages[0]["steps"] != nil {
			if _, exists := turns[id]; !exists {
				turns[id] = messages[0]
				continue
			}
		}
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
	latestRun := ""
	if len(ordered) > 0 {
		latestRun = ordered[len(ordered)-1]
	}
	for id, turn := range turns {
		if id != latestRun {
			turn["canRetry"] = false
		}
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

func (service *AgentRuntime) readEvents(ctx context.Context, sessionID string, after int64) ([]ConversationEvent, error) {
	rows, err := service.db.QueryContext(ctx, `SELECT sequence,event_json FROM chat_events WHERE session_id=? AND sequence>? AND revision=(SELECT revision FROM chat_sessions WHERE id=?) ORDER BY sequence LIMIT 256`, sessionID, after, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []ConversationEvent{}
	for rows.Next() {
		var cursor int64
		var encoded string
		if err := rows.Scan(&cursor, &encoded); err != nil {
			return nil, err
		}
		var event ConversationEvent
		if err := json.Unmarshal([]byte(encoded), &event); err != nil {
			return nil, err
		}
		event.Cursor = cursor
		events = append(events, event)
	}
	return events, rows.Err()
}

func (service *AgentRuntime) notifyQueue() {
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
