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

func (service *AgentRuntime) runAsync(record executionRecord, session sessionRecord, history []map[string]any, input SubmitTurnInput) {
	ctx, cancel := context.WithTimeout(service.workerContext, 10*time.Minute)
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

func (service *AgentRuntime) executeRun(ctx context.Context, record executionRecord, session sessionRecord, history []map[string]any, input SubmitTurnInput) {
	sink := &persistedGenerationSink{service: service, record: record, session: &session}
	err := service.executeGeneration(ctx, generationExecutionInput{AcceptedAt: record.AcceptedAt, UserID: record.UserID, RunID: record.ID, AssistantTurnID: record.AssistantTurnID, History: history, Request: input}, sink)
	if err != nil {
		// Persist the last accepted checkpoint, never output obtained after invalidation.
		status := "error"
		if service.workerContext.Err() != nil {
			status = "interrupted"
		}
		service.finishOwnedRun(record, status, err)
	}
	log.Printf("kairos: stage=run_completion run=%s duration_ms=%d error=%v", record.ID, time.Now().UnixMilli()-record.AcceptedAt, err)
}

type persistedGenerationSink struct {
	service        *AgentRuntime
	record         executionRecord
	session        *sessionRecord
	lastCheckpoint time.Time
}

func (sink *persistedGenerationSink) ModelResolved(model ProviderModel) error {
	tx, err := sink.service.beginEventTx(context.Background(), nil)
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

// This boundary is crossed immediately before contacting the model provider.
func (sink *persistedGenerationSink) ModelStarted() error {
	if sink.service.workerContext.Err() != nil {
		return sink.service.workerContext.Err()
	}
	ctx := context.Background()
	tx, err := sink.service.beginEventTx(ctx, nil)
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
	if _, err := tx.ExecContext(ctx, `UPDATE chat_runs SET status='running' WHERE id=?`, sink.record.ID); err != nil {
		return err
	}
	if err := sink.service.refreshTurnExec(ctx, tx, sink.record.ID, "delta"); err != nil {
		return err
	}
	return tx.Commit()
}

func (sink *persistedGenerationSink) Delta(message map[string]any) error {
	// Full snapshots stay in chat_runs; the journal stores compact patches.
	// At most 10 checkpoints/s, with immediate first progress.
	if !sink.lastCheckpoint.IsZero() && time.Since(sink.lastCheckpoint) < 100*time.Millisecond {
		return nil
	}
	checkpointStarted := time.Now()
	firstCheckpoint := sink.lastCheckpoint.IsZero()
	ctx := context.Background()
	tx, err := sink.service.beginEventTx(ctx, nil)
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
	if firstCheckpoint {
		log.Printf("kairos: stage=event_commit run=%s state=delta duration_ms=%d", sink.record.ID, time.Since(checkpointStarted).Milliseconds())
	}
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

func (service *AgentRuntime) appendStagedRunMessagesIfRunning(ctx context.Context, record executionRecord, session sessionRecord, messages []map[string]any, options appendMessageOptions) (SessionSummary, bool, error) {
	return service.commitRunMessages(ctx, record, session, messages, options, false, 0)
}

func (service *AgentRuntime) completeRunWithFinalMessage(ctx context.Context, record executionRecord, session sessionRecord, message map[string]any, timestamp, finalTotalTokens int64) (SessionSummary, bool, error) {
	return service.commitRunMessages(ctx, record, session, []map[string]any{message}, appendMessageOptions{}, true, finalTotalTokens)
}

func (service *AgentRuntime) commitRunMessages(ctx context.Context, record executionRecord, session sessionRecord, messages []map[string]any, options appendMessageOptions, final bool, totalTokens int64) (SessionSummary, bool, error) {
	checkpointStarted := time.Now()
	tx, err := service.beginEventTx(ctx, nil)
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
		summary, err = service.conversations.appendMessageWithOptionsExec(ctx, tx, session, message, int64Value(message["timestamp"]), options)
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
	log.Printf("kairos: stage=event_commit run=%s state=%s duration_ms=%d", record.ID, state, time.Since(checkpointStarted).Milliseconds())
	return summary, true, nil
}

func (service *AgentRuntime) runStatus(ctx context.Context, runID string) (string, error) {
	var status string
	if err := service.db.QueryRowContext(ctx, `SELECT status FROM chat_runs WHERE id=?`, runID).Scan(&status); err != nil {
		return "", fmt.Errorf("load run status: %w", err)
	}
	return status, nil
}

func (service *AgentRuntime) registerRunCancel(record executionRecord, cancel context.CancelFunc) {
	service.runMu.Lock()
	defer service.runMu.Unlock()
	service.runControls[record.ID] = executionControl{LeaseToken: record.LeaseToken, Cancel: cancel}

}
func (service *AgentRuntime) unregisterRunCancel(record executionRecord) {
	service.runMu.Lock()
	defer service.runMu.Unlock()
	if control, ok := service.runControls[record.ID]; ok && control.LeaseToken == record.LeaseToken {
		delete(service.runControls, record.ID)
		service.notifyQueue()
	}

}

func (sink *persistedGenerationSink) BeforeTool(message map[string]any, call ProviderToolCall) error {
	sink.lastCheckpoint = time.Time{}
	return sink.Delta(toolStartedSnapshot(message, call.ID))
}

// Completed tool results checkpoint individually, before the next tool starts.
func (sink *persistedGenerationSink) ToolCompleted(message map[string]any) error {
	sink.lastCheckpoint = time.Time{}
	return sink.Delta(message)
}
