package server

import "context"

// Command acknowledgements fence in-flight events without clients guessing
// which turns a history mutation removed.
type CommandChanges struct {
	InvalidatedRunIDs []string `json:"invalidatedRunIds,omitempty"`
	RemovedTurnIDs    []string `json:"removedTurnIds,omitempty"`
}

func collectCommandChanges(ctx context.Context, exec sqlExecutor, sessionID string, cutoff int64, retainedUserID string) (CommandChanges, error) {
	changes := CommandChanges{}
	rows, err := exec.QueryContext(ctx, `SELECT id,COALESCE(assistant_message_id,id) FROM chat_runs WHERE session_id=? AND started_at>=?`, sessionID, cutoff)
	if err != nil {
		return changes, err
	}
	for rows.Next() {
		var id, turnID string
		if err := rows.Scan(&id, &turnID); err != nil {
			rows.Close()
			return changes, err
		}
		changes.InvalidatedRunIDs = append(changes.InvalidatedRunIDs, id)
		changes.RemovedTurnIDs = append(changes.RemovedTurnIDs, turnID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return changes, err
	}
	rows.Close()
	rows, err = exec.QueryContext(ctx, `SELECT json_extract(message_json,'$.id') FROM chat_messages WHERE session_id=? AND timestamp>=? AND json_extract(message_json,'$.id')!=?`, sessionID, cutoff, retainedUserID)
	if err != nil {
		return changes, err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return changes, err
		}
		changes.RemovedTurnIDs = append(changes.RemovedTurnIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return changes, err
	}
	rows.Close()
	return changes, nil
}
