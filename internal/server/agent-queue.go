package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"time"
)

const workerLease = 30 * time.Second

func (service *AgentRuntime) StartWorkers() {
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

func (service *AgentRuntime) Close() {
	if service.workerCancel != nil {
		service.workerCancel()
	}
	service.runMu.Lock()
	ids := []string{}
	for id, cancel := range service.runCancels {
		ids = append(ids, id)
		cancel()
	}
	service.runMu.Unlock()
	// Fence local workers before closing SQLite, including adapters slow to cancel.
	ctx := context.Background()
	tx, err := service.db.BeginTx(ctx, nil)
	if err == nil {
		for _, id := range ids {
			result, updateErr := tx.ExecContext(ctx, `UPDATE chat_runs SET status='interrupted',completed_at=?,error_message='Server shut down during execution',lease_token='' WHERE id=? AND status IN ('preparing','running')`, time.Now().UnixMilli(), id)
			if updateErr != nil {
				err = updateErr
				break
			}
			count, _ := result.RowsAffected()
			if count > 0 {
				if err = service.refreshTurnExec(ctx, tx, id, "error"); err != nil {
					break
				}
				if _, err = tx.ExecContext(ctx, `DELETE FROM chat_jobs WHERE run_id=?`, id); err != nil {
					break
				}
			}
		}
		if err == nil {
			err = tx.Commit()
		} else {
			_ = tx.Rollback()
		}
	}
	if err != nil {
		log.Printf("kairos: shutdown checkpoint: %v", err)
	}
	done := make(chan struct{})
	go func() { service.workerWG.Wait(); close(done) }()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		log.Printf("kairos: shutdown grace expired; remaining workers are fenced")
	}
}

func (service *AgentRuntime) dispatchJobs(ctx context.Context) error {
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
	service.runMu.Lock()
	active := len(service.runCancels)
	service.runMu.Unlock()
	if active >= 4 {
		return tx.Commit()
	}
	var record executionRecord
	var requestJSON, friendlyID string
	err = tx.QueryRowContext(ctx, `SELECT r.id,r.user_id,r.session_id,r.model,r.assistant_message_id,r.revision,r.request_json,s.friendly_id,r.created_at FROM chat_jobs j JOIN chat_runs r ON r.id=j.run_id JOIN chat_sessions s ON s.id=r.session_id WHERE r.status='queued' AND r.invalidated=0 AND r.revision=s.revision AND j.available_at<=? ORDER BY j.available_at,r.created_at LIMIT 1`, now).Scan(&record.ID, &record.UserID, &record.SessionID, &record.Model, &record.AssistantTurnID, &record.Revision, &requestJSON, &friendlyID, &record.AcceptedAt)
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
	var input SubmitTurnInput
	if err := json.Unmarshal([]byte(requestJSON), &input); err != nil {
		service.finishOwnedRun(record, "error", err)
		return nil
	}
	input.FriendlyID = friendlyID
	session, err := service.conversations.findSessionByFriendlyID(ctx, record.UserID, friendlyID)
	if err != nil {
		return err
	}
	history, err := service.conversations.getTranscript(ctx, record.UserID, friendlyID)
	if err != nil {
		service.finishOwnedRun(record, "error", err)
		return nil
	}
	log.Printf("kairos: stage=worker_claim run=%s revision=%d queue_ms=%d", record.ID, record.Revision, time.Now().UnixMilli()-record.AcceptedAt)
	service.runAsync(record, session, history.Messages, input)
	return nil
}

func (service *AgentRuntime) guardRunExec(ctx context.Context, exec sqlExecutor, record executionRecord) (bool, error) {
	result, err := exec.ExecContext(ctx, `UPDATE chat_runs SET lease_until=? WHERE id=? AND status IN ('preparing','running') AND invalidated=0 AND revision=(SELECT revision FROM chat_sessions WHERE id=chat_runs.session_id) AND lease_token=? AND lease_until>?`, time.Now().Add(workerLease).UnixMilli(), record.ID, record.LeaseToken, time.Now().UnixMilli())
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	return n > 0, err
}
