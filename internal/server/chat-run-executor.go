package server

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"
)

func (service *ChatRunService) runAsync(
	record runRecord,
	session sessionRecord,
	history []map[string]any,
	input SendMessageInput,
) {
	ctx, cancel := context.WithCancel(context.Background())
	service.registerRunCancel(record, cancel)
	go func() {
		defer service.unregisterRunCancel(record)
		service.executeRun(ctx, record, session, history, input)
	}()
}

const (
	defaultMaxToolCalls = 24
	maxToolCallLimit    = 100
)

func (service *ChatRunService) executeRun(
	ctx context.Context,
	record runRecord,
	session sessionRecord,
	history []map[string]any,
	input SendMessageInput,
) {
	sink := &persistedGenerationSink{
		service: service,
		record:  record,
		session: &session,
	}
	outcome, err := service.executeGeneration(
		ctx,
		generationExecutionInput{
			UserID:             record.UserID,
			RunID:              record.ID,
			AssistantMessageID: record.AssistantMessageID,
			History:            history,
			Request:            input,
		},
		sink,
	)
	if err == nil {
		return
	}
	if errors.Is(err, context.Canceled) ||
		errors.Is(err, errGenerationInactive) {
		service.publishRunAborted(
			context.Background(),
			record,
			session,
			outcome.PartialMessage,
		)
		return
	}
	service.publishRunError(context.Background(), record, session, err)
}

type persistedGenerationSink struct {
	service *ChatRunService
	record  runRecord
	session *sessionRecord
}

func (sink *persistedGenerationSink) ModelResolved(model ProviderModel) error {
	if model.ContextWindow <= 0 {
		return nil
	}
	if err := sink.service.chat.UpdateSessionContextTokens(
		context.Background(),
		sink.session.ID,
		sink.session.UserID,
		model.ContextWindow,
	); err == nil {
		sink.session.ContextTokens = model.ContextWindow
	}
	return nil
}

func (sink *persistedGenerationSink) Delta(message map[string]any) error {
	sink.service.broker.Publish(
		sink.record.SessionID,
		buildRunEvent(
			sink.record,
			*sink.session,
			"delta",
			"",
			message,
		),
	)
	return nil
}

func (sink *persistedGenerationSink) ToolRound(
	messages []map[string]any,
	totalTokens int64,
) error {
	sessionSummary, committed, err :=
		sink.service.appendStagedRunMessagesIfRunning(
			context.Background(),
			sink.record,
			*sink.session,
			messages,
			appendMessageOptions{SkipDerivedTitle: true},
		)
	if err != nil {
		return err
	}
	if !committed {
		return errGenerationInactive
	}
	sink.session.TotalTokens = sessionSummary.TotalTokens
	if totalTokens > 0 {
		if err := sink.service.chat.UpdateSessionTotalTokens(
			context.Background(),
			sink.session.ID,
			sink.session.UserID,
			totalTokens,
		); err != nil {
			return err
		}
		sink.session.TotalTokens = totalTokens
	}
	for _, message := range messages {
		if err := sink.Delta(message); err != nil {
			return err
		}
	}
	return nil
}

func (sink *persistedGenerationSink) Final(
	message map[string]any,
	totalTokens int64,
) error {
	timestamp := int64Value(message["timestamp"])
	sessionSummary, completed, err :=
		sink.service.completeRunWithFinalMessage(
			context.Background(),
			sink.record,
			*sink.session,
			message,
			timestamp,
			totalTokens,
		)
	if err != nil {
		return err
	}
	if !completed {
		return errGenerationInactive
	}
	if totalTokens > 0 {
		sink.session.TotalTokens = totalTokens
	}
	sink.service.broker.Publish(
		sink.record.SessionID,
		buildRunEventWithSession(
			sink.record,
			*sink.session,
			"final",
			"",
			message,
			&sessionSummary,
		),
	)
	return nil
}

func (service *ChatRunService) publishRunError(
	ctx context.Context,
	record runRecord,
	session sessionRecord,
	runErr error,
) {
	normalizedError := strings.TrimSpace(runErr.Error())
	if normalizedError == "" {
		normalizedError = "run failed"
	}
	claimed, err := service.markRunFailed(ctx, record.ID, runErr)
	if err != nil {
		log.Printf("kairos: failed to persist run error for run %s: %v", record.ID, err)
		return
	}
	if !claimed {
		return
	}
	log.Printf("kairos: run %s failed for session %s (%s): %s", record.ID, session.ID, session.FriendlyID, normalizedError)
	service.broker.Publish(record.SessionID, buildRunEvent(record, session, "error", normalizedError, nil))
}

func (service *ChatRunService) publishRunAborted(
	ctx context.Context,
	record runRecord,
	session sessionRecord,
	message map[string]any,
) {
	persistCtx := context.Background()
	claimed, err := service.claimRunAborted(persistCtx, record.ID)
	if err != nil {
		log.Printf("kairos: failed to persist run abort for run %s: %v", record.ID, err)
		return
	}
	if !claimed {
		status, statusErr := service.runStatus(persistCtx, record.ID)
		if statusErr != nil {
			log.Printf("kairos: failed to load run status for aborted run %s: %v", record.ID, statusErr)
			return
		}
		if status != "aborted" {
			return
		}
	}

	var sessionSummary *SessionSummary
	if len(message) > 0 {
		timestamp, _ := message["timestamp"].(int64)
		if timestamp == 0 {
			timestamp = time.Now().UnixMilli()
			message["timestamp"] = timestamp
		}
		summary, err := service.chat.appendMessage(persistCtx, session, message, timestamp)
		if err != nil {
			log.Printf("kairos: failed to persist aborted run message for run %s: %v", record.ID, err)
		} else {
			sessionSummary = &summary
		}
	}
	service.broker.Publish(record.SessionID, buildRunEventWithSession(record, session, "aborted", "", message, sessionSummary))
}

func (service *ChatRunService) appendStagedRunMessagesIfRunning(
	ctx context.Context,
	record runRecord,
	session sessionRecord,
	messages []map[string]any,
	options appendMessageOptions,
) (SessionSummary, bool, error) {
	if len(messages) == 0 {
		summary, err := sessionRecordToSummary(session)
		return summary, true, err
	}
	transaction, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionSummary{}, false, fmt.Errorf("begin staged run messages tx: %w", err)
	}
	defer transaction.Rollback()

	result, err := transaction.ExecContext(ctx, `
		UPDATE chat_runs
		SET status = status
		WHERE id = ? AND status = 'running'
	`, record.ID)
	if err != nil {
		return SessionSummary{}, false, fmt.Errorf("guard staged run messages: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return SessionSummary{}, false, fmt.Errorf("guard staged run messages rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return SessionSummary{}, false, nil
	}

	var summary SessionSummary
	current := session
	for _, message := range messages {
		timestamp := int64Value(message["timestamp"])
		if timestamp == 0 {
			timestamp = time.Now().UnixMilli()
			message["timestamp"] = timestamp
		}
		summary, err = service.chat.appendMessageWithOptionsExec(ctx, transaction, current, message, timestamp, options)
		if err != nil {
			return SessionSummary{}, false, err
		}
		current.LastMessageJSON = nullableJSONObject(message)
		current.UpdatedAt = summary.UpdatedAt
		current.TotalTokens = summary.TotalTokens
		if summary.DerivedTitle != "" {
			current.DerivedTitle = nullableString(summary.DerivedTitle)
		}
	}
	if err := transaction.Commit(); err != nil {
		return SessionSummary{}, false, fmt.Errorf("commit staged run messages tx: %w", err)
	}
	return summary, true, nil
}

func (service *ChatRunService) completeRunWithFinalMessage(
	ctx context.Context,
	record runRecord,
	session sessionRecord,
	message map[string]any,
	timestamp int64,
	finalTotalTokens int64,
) (SessionSummary, bool, error) {
	transaction, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return SessionSummary{}, false, fmt.Errorf("begin complete run tx: %w", err)
	}
	defer transaction.Rollback()

	result, err := transaction.ExecContext(ctx, `
		UPDATE chat_runs
		SET status = 'completed', completed_at = ?, error_message = NULL
		WHERE id = ? AND status = 'running'
	`, timestamp, record.ID)
	if err != nil {
		return SessionSummary{}, false, fmt.Errorf("complete run: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return SessionSummary{}, false, fmt.Errorf("complete run rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return SessionSummary{}, false, nil
	}

	summary, err := service.chat.appendMessageWithOptionsExec(ctx, transaction, session, message, timestamp, appendMessageOptions{})
	if err != nil {
		return SessionSummary{}, false, err
	}
	if finalTotalTokens > 0 {
		result, err := transaction.ExecContext(ctx, `
			UPDATE chat_sessions
			SET total_tokens = ?
			WHERE id = ? AND user_id = ?
		`, finalTotalTokens, session.ID, session.UserID)
		if err != nil {
			return SessionSummary{}, false, fmt.Errorf("update final total tokens: %w", err)
		}
		rowsAffected, err := result.RowsAffected()
		if err != nil {
			return SessionSummary{}, false, fmt.Errorf("update final total tokens rows affected: %w", err)
		}
		if rowsAffected == 0 {
			return SessionSummary{}, false, fmt.Errorf("update final total tokens: session not found")
		}
		summary.TotalTokens = finalTotalTokens
	}
	if err := transaction.Commit(); err != nil {
		return SessionSummary{}, false, fmt.Errorf("commit complete run tx: %w", err)
	}
	return summary, true, nil
}

func (service *ChatRunService) markRunFailed(ctx context.Context, runID string, runErr error) (bool, error) {
	result, err := service.db.ExecContext(ctx, `
		UPDATE chat_runs
		SET status = 'error', completed_at = ?, error_message = ?
		WHERE id = ? AND status = 'running'
	`, time.Now().UnixMilli(), strings.TrimSpace(runErr.Error()), runID)
	if err != nil {
		return false, fmt.Errorf("fail run: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("fail run rows affected: %w", err)
	}
	return rowsAffected > 0, nil
}

func (service *ChatRunService) claimRunAborted(ctx context.Context, runID string) (bool, error) {
	result, err := service.db.ExecContext(ctx, `
		UPDATE chat_runs
		SET status = 'aborted', completed_at = ?, error_message = NULL
		WHERE id = ? AND status = 'running'
	`, time.Now().UnixMilli(), runID)
	if err != nil {
		return false, fmt.Errorf("abort run: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("abort run rows affected: %w", err)
	}
	return rowsAffected > 0, nil
}

func (service *ChatRunService) runStatus(ctx context.Context, runID string) (string, error) {
	var status string
	if err := service.db.QueryRowContext(ctx, `
		SELECT status
		FROM chat_runs
		WHERE id = ?
	`, runID).Scan(&status); err != nil {
		return "", fmt.Errorf("load run status: %w", err)
	}
	return status, nil
}

func (service *ChatRunService) registerRunCancel(record runRecord, cancel context.CancelFunc) {
	service.runMu.Lock()
	defer service.runMu.Unlock()
	service.runCancels[record.ID] = cancel
	service.runDone[record.ID] = make(chan struct{})
	if service.sessionRuns[record.SessionID] == nil {
		service.sessionRuns[record.SessionID] = make(map[string]struct{})
	}
	service.sessionRuns[record.SessionID][record.ID] = struct{}{}
}

func (service *ChatRunService) unregisterRunCancel(record runRecord) {
	service.runMu.Lock()
	defer service.runMu.Unlock()
	delete(service.runCancels, record.ID)
	delete(service.stoppingRuns, record.ID)
	if done := service.runDone[record.ID]; done != nil {
		close(done)
		delete(service.runDone, record.ID)
	}
	sessionRuns := service.sessionRuns[record.SessionID]
	if sessionRuns == nil {
		return
	}
	delete(sessionRuns, record.ID)
	if len(sessionRuns) == 0 {
		delete(service.sessionRuns, record.SessionID)
	}
}
