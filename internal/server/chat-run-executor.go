package server

import (
	"context"
	"fmt"
	"log"
	"time"
)

const (
	defaultMaxToolCalls = 24
	maxToolCallLimit    = 100
)

func (service *ChatRunService) runAsync(record runRecord, session sessionRecord, history []map[string]any, input SendMessageInput) {
	ctx, cancel := context.WithCancel(service.workerContext)
	service.registerRunCancel(record, cancel)
	service.workerWG.Add(1)
	go func() {
		defer service.workerWG.Done()
		defer service.unregisterRunCancel(record)
		defer cancel()
		heartbeatDone := make(chan struct{})
		go func() {
			defer close(heartbeatDone)
			ticker := time.NewTicker(workerLease / 3)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					valid, err := service.guardRunExec(ctx, service.db, record)
					if err != nil || !valid {
						cancel()
						return
					}
				}
			}
		}()
		service.executeRun(ctx, record, session, history, input)
		cancel()
		<-heartbeatDone
	}()
}

func (service *ChatRunService) executeRun(ctx context.Context, record runRecord, session sessionRecord, history []map[string]any, input SendMessageInput) {
	sink := &persistedGenerationSink{service: service, record: record, session: &session}
	_, err := service.executeGeneration(ctx, generationExecutionInput{UserID: record.UserID, RunID: record.ID, AssistantMessageID: record.AssistantMessageID, History: history, Request: input}, sink)
	if err != nil {
		// Persist the last accepted checkpoint, never output obtained after invalidation.
		service.finishOwnedRun(record, "error", err)
	}
	log.Printf("kairos: stage=run_completion run=%s error=%v", record.ID, err)
}

type persistedGenerationSink struct {
	service        *ChatRunService
	record         runRecord
	session        *sessionRecord
	lastCheckpoint time.Time
}

func (sink *persistedGenerationSink) ModelResolved(model ProviderModel) error {
	tx, err := sink.service.db.BeginTx(context.Background(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	valid, err := sink.service.guardRunExec(context.Background(), tx, sink.record)
	if err != nil {
		return err
	}
	if !valid {
		return errGenerationInactive
	}
	if _, err := tx.Exec(`UPDATE chat_runs SET status='running' WHERE id=?`, sink.record.ID); err != nil {
		return err
	}
	if model.ContextWindow > 0 {
		if _, err := tx.Exec(`UPDATE chat_sessions SET context_tokens=? WHERE id=?`, model.ContextWindow, sink.session.ID); err != nil {
			return err
		}
		sink.session.ContextTokens = model.ContextWindow
	}
	if err := sink.service.refreshTurnExec(context.Background(), tx, sink.record.ID, "delta"); err != nil {
		return err
	}
	log.Printf("kairos: stage=model_resolved run=%s", sink.record.ID)
	return tx.Commit()
}

func (sink *persistedGenerationSink) Delta(message map[string]any) error {
	// Full replacements are safe to replay. At most 20 checkpoints/s, with immediate first progress.
	if !sink.lastCheckpoint.IsZero() && time.Since(sink.lastCheckpoint) < 50*time.Millisecond {
		return nil
	}
	ctx := context.Background()
	tx, err := sink.service.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	valid, err := sink.service.guardRunExec(ctx, tx, sink.record)
	if err != nil {
		return err
	}
	if !valid {
		return errGenerationInactive
	}
	if err := checkpointStepExec(ctx, tx, sink.record.ID, message); err != nil {
		return err
	}
	if err := sink.service.refreshTurnExec(ctx, tx, sink.record.ID, "delta"); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	sink.lastCheckpoint = time.Now()
	return nil
}

func (sink *persistedGenerationSink) ToolRound(messages []map[string]any, totalTokens int64) error {
	summary, committed, err := sink.service.appendStagedRunMessagesIfRunning(context.Background(), sink.record, *sink.session, messages, appendMessageOptions{SkipDerivedTitle: true})
	if err != nil {
		return err
	}
	if !committed {
		return errGenerationInactive
	}
	sink.session.TotalTokens = summary.TotalTokens
	return nil
}

func (sink *persistedGenerationSink) Final(message map[string]any, totalTokens int64) error {
	_, committed, err := sink.service.completeRunWithFinalMessage(context.Background(), sink.record, *sink.session, message, int64Value(message["timestamp"]), totalTokens)
	if err != nil {
		return err
	}
	if !committed {
		return errGenerationInactive
	}
	return nil
}

func (service *ChatRunService) appendStagedRunMessagesIfRunning(ctx context.Context, record runRecord, session sessionRecord, messages []map[string]any, options appendMessageOptions) (SessionSummary, bool, error) {
	return service.commitRunMessages(ctx, record, session, messages, options, false, 0)
}

func (service *ChatRunService) completeRunWithFinalMessage(ctx context.Context, record runRecord, session sessionRecord, message map[string]any, timestamp, finalTotalTokens int64) (SessionSummary, bool, error) {
	return service.commitRunMessages(ctx, record, session, []map[string]any{message}, appendMessageOptions{}, true, finalTotalTokens)
}

func (service *ChatRunService) commitRunMessages(ctx context.Context, record runRecord, session sessionRecord, messages []map[string]any, options appendMessageOptions, final bool, totalTokens int64) (SessionSummary, bool, error) {
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionSummary{}, false, err
	}
	defer tx.Rollback()
	valid, err := service.guardRunExec(ctx, tx, record)
	if err != nil || !valid {
		return SessionSummary{}, false, err
	}
	summary, err := sessionRecordToSummary(session)
	if err != nil {
		return summary, false, err
	}
	for _, message := range messages {
		summary, err = service.chat.appendMessageWithOptionsExec(ctx, tx, session, message, int64Value(message["timestamp"]), options)
		if err != nil {
			return summary, false, err
		}
		session.TotalTokens = summary.TotalTokens
		session.LastMessageJSON = nullableJSONObject(message)
		if err := checkpointStepExec(ctx, tx, record.ID, message); err != nil {
			return summary, false, err
		}
	}
	state := "delta"
	if final {
		state = "final"
		if _, err := tx.ExecContext(ctx, `UPDATE chat_runs SET status='completed',completed_at=?,lease_token='' WHERE id=?`, time.Now().UnixMilli(), record.ID); err != nil {
			return summary, false, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM chat_jobs WHERE run_id=?`, record.ID); err != nil {
			return summary, false, err
		}
		if totalTokens > 0 {
			if _, err := tx.ExecContext(ctx, `UPDATE chat_sessions SET total_tokens=? WHERE id=?`, totalTokens, session.ID); err != nil {
				return summary, false, err
			}
			summary.TotalTokens = totalTokens
		}
	}
	if err := service.refreshTurnExec(ctx, tx, record.ID, state); err != nil {
		return summary, false, err
	}
	if err := tx.Commit(); err != nil {
		return summary, false, err
	}
	return summary, true, nil
}

func (service *ChatRunService) runStatus(ctx context.Context, runID string) (string, error) {
	var status string
	if err := service.db.QueryRowContext(ctx, `SELECT status FROM chat_runs WHERE id=?`, runID).Scan(&status); err != nil {
		return "", fmt.Errorf("load run status: %w", err)
	}
	return status, nil
}

func (service *ChatRunService) registerRunCancel(record runRecord, cancel context.CancelFunc) {
	service.runMu.Lock()
	defer service.runMu.Unlock()
	service.runCancels[record.ID] = cancel
	if service.sessionRuns[record.SessionID] == nil {
		service.sessionRuns[record.SessionID] = map[string]struct{}{}
	}
	service.sessionRuns[record.SessionID][record.ID] = struct{}{}
}
func (service *ChatRunService) unregisterRunCancel(record runRecord) {
	service.runMu.Lock()
	defer service.runMu.Unlock()
	delete(service.runCancels, record.ID)
	delete(service.sessionRuns[record.SessionID], record.ID)
	if len(service.sessionRuns[record.SessionID]) == 0 {
		delete(service.sessionRuns, record.SessionID)
	}
}

func (sink *persistedGenerationSink) BeforeTool(message map[string]any) error {
	sink.lastCheckpoint = time.Time{}
	return sink.Delta(message)
}
