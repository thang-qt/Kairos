package server

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
)

func patchTurnValue(value any, path []string, operation TurnPatchOperation) (any, error) {
	if len(path) == 0 {
		if operation.Op == "append" {
			before, ok := value.(string)
			suffix, valid := operation.Value.(string)
			if !ok || !valid {
				return nil, fmt.Errorf("invalid string append")
			}
			return before + suffix, nil
		}
		if operation.Op == "set" {
			return operation.Value, nil
		}
		return nil, fmt.Errorf("invalid patch operation")
	}
	key := path[0]
	switch container := value.(type) {
	case map[string]any:
		if len(path) == 1 && operation.Op == "remove" {
			delete(container, key)
			return container, nil
		}
		child, err := patchTurnValue(container[key], path[1:], operation)
		if err != nil {
			return nil, err
		}
		container[key] = child
		return container, nil
	case []any:
		index, err := strconv.Atoi(key)
		if err != nil || index < 0 || index > len(container) {
			return nil, fmt.Errorf("invalid array patch index")
		}
		if len(path) == 1 && operation.Op == "remove" {
			if index == len(container) {
				return nil, fmt.Errorf("missing array patch target")
			}
			return append(container[:index], container[index+1:]...), nil
		}
		if index == len(container) {
			container = append(container, nil)
		}
		child, err := patchTurnValue(container[index], path[1:], operation)
		if err != nil {
			return nil, err
		}
		container[index] = child
		return container, nil
	default:
		return nil, fmt.Errorf("invalid patch target")
	}
}

// The journal is a durable incremental checkpoint between complete snapshots.
// Replay is needed only when loading history, crossing a boundary, or recovering.
func (service *AgentRuntime) replayRunCheckpoint(ctx context.Context, exec sqlExecutor, runID string) (map[string]any, error) {
	var encoded, sessionID string
	var cursor, revision int64
	if err := exec.QueryRowContext(ctx, `SELECT turn_json,turn_cursor,session_id,revision FROM chat_runs WHERE id=?`, runID).Scan(&encoded, &cursor, &sessionID, &revision); err != nil {
		return nil, err
	}
	var turn map[string]any
	if err := json.Unmarshal([]byte(encoded), &turn); err != nil {
		return nil, err
	}
	rows, err := exec.QueryContext(ctx, `SELECT event_json FROM chat_events WHERE session_id=? AND revision=? AND sequence>? ORDER BY sequence`, sessionID, revision, cursor)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var encoded string
		if err := rows.Scan(&encoded); err != nil {
			return nil, err
		}
		var event ConversationEvent
		if err := json.Unmarshal([]byte(encoded), &event); err != nil {
			return nil, err
		}
		if event.RunID != runID {
			continue
		}
		if event.Message != nil {
			turn = event.Message
		}
		for _, operation := range event.TurnPatch {
			patched, err := patchTurnValue(turn, operation.Path, operation)
			if err != nil {
				return nil, err
			}
			var ok bool
			turn, ok = patched.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid turn patch root")
			}
		}
	}
	return turn, rows.Err()
}
func (service *AgentRuntime) materializeRunCheckpoint(ctx context.Context, exec sqlExecutor, runID string) error {
	var dirty bool
	if err := exec.QueryRowContext(ctx, `SELECT turn_dirty FROM chat_runs WHERE id=?`, runID).Scan(&dirty); err != nil {
		return err
	}
	if !dirty {
		return nil
	}
	turn, err := service.replayRunCheckpoint(ctx, exec, runID)
	if err != nil {
		return err
	}
	steps, _ := turn["steps"].([]any)
	for _, value := range steps {
		step, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("invalid checkpoint step")
		}
		if err := checkpointStepExec(ctx, exec, runID, step); err != nil {
			return err
		}
	}
	// Future boundary diffs must start from what subscribers have already seen,
	// not the older complete snapshot, or append patches would repeat text.
	encoded, err := json.Marshal(turn)
	if err != nil {
		return err
	}
	if _, err := exec.ExecContext(ctx, `UPDATE chat_runs SET turn_json=?,turn_dirty=0 WHERE id=?`, string(encoded), runID); err != nil {
		return err
	}
	_, err = exec.ExecContext(ctx, `UPDATE chat_runs SET turn_cursor=(SELECT COALESCE(MAX(sequence),0) FROM chat_events WHERE session_id=chat_runs.session_id) WHERE id=?`, runID)
	return err
}
func updateRunCheckpointCursor(ctx context.Context, exec sqlExecutor, runID, sessionID string) error {
	_, err := exec.ExecContext(ctx, `UPDATE chat_runs SET turn_cursor=(SELECT COALESCE(MAX(sequence),0) FROM chat_events WHERE session_id=?) WHERE id=?`, sessionID, runID)
	return err
}
