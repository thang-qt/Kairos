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
	abortIfCanceled := func() bool {
		if ctx.Err() == nil {
			return false
		}
		service.publishRunAborted(ctx, record, session, nil)
		return true
	}
	if abortIfCanceled() {
		return
	}

	provider, model, _, err := service.providers.ResolveGenerationTarget(ctx, record.UserID, record.Model)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			service.publishRunAborted(ctx, record, session, nil)
			return
		}
		service.publishRunError(ctx, record, session, err)
		return
	}
	if abortIfCanceled() {
		return
	}
	if model.ContextWindow > 0 {
		if err := service.chat.UpdateSessionContextTokens(ctx, session.ID, session.UserID, model.ContextWindow); err == nil {
			session.ContextTokens = model.ContextWindow
		}
	}

	driver := service.providers.drivers[provider.Record.Kind]
	if driver == nil {
		service.publishRunError(ctx, record, session, fmt.Errorf("unsupported provider kind: %s", provider.Record.Kind))
		return
	}

	displayModel := assistantModelDisplay{
		ID:          model.ID,
		Name:        firstNonEmpty(model.Name, model.ID),
		Description: provider.Record.Label,
	}
	nextTimestamp := latestMessageTimestamp(history) + 1
	newTimestamp := func() int64 {
		timestamp := maxInt64(time.Now().UnixMilli(), nextTimestamp)
		nextTimestamp = timestamp + 1
		return timestamp
	}
	updateTotalTokens := func(totalTokens int64) bool {
		if totalTokens <= 0 {
			return true
		}
		if err := service.chat.UpdateSessionTotalTokens(context.Background(), session.ID, session.UserID, totalTokens); err != nil {
			service.publishRunError(context.Background(), record, session, err)
			return false
		}
		session.TotalTokens = totalTokens
		return true
	}

	effectiveSystemPrompt := buildEffectiveSystemPrompt(input.SystemPrompt, history, time.Now(), input.ClientTime, input.ClientTimeZone)
	messages := buildProviderMessages(history, effectiveSystemPrompt)
	tools := buildRuntimeTools(input.WebSearch, input.MathTools)
	toolCallLimit := defaultMaxToolCalls
	if len(tools) > 0 && service.webSettings != nil {
		toolCallLimit, err = service.webSettings.ResolveToolCallLimit(ctx, record.UserID)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				service.publishRunAborted(ctx, record, session, nil)
				return
			}
			service.publishRunError(ctx, record, session, err)
			return
		}
	}
	toolRuntime := toolExecutor(NewWebToolRuntimeFromEnv())
	if service.toolRuntime != nil {
		resolvedRuntime, runtimeErr := service.toolRuntime(ctx, record.UserID, input)
		if runtimeErr != nil {
			if errors.Is(runtimeErr, context.Canceled) {
				service.publishRunAborted(ctx, record, session, nil)
				return
			}
			service.publishRunError(ctx, record, session, runtimeErr)
			return
		}
		if resolvedRuntime != nil {
			toolRuntime = resolvedRuntime
		}
	}

	executedToolCalls := 0
	assistantMessageID := record.AssistantMessageID
	for roundIndex := 0; ; roundIndex++ {
		if abortIfCanceled() {
			return
		}
		assistantTimestamp := newTimestamp()
		accumulatedText := ""
		accumulatedThinking := ""
		accumulatedToolCalls := []ProviderToolCall{}
		accumulatedToolProgress := []ProviderToolProgress{}
		toolProgressStartedAt := make(map[string]time.Time)
		result, err := driver.GenerateChatStream(
			ctx,
			provider,
			ChatGenerationRequest{
				Model:        model.ID,
				SystemPrompt: effectiveSystemPrompt,
				Messages:     messages,
				Tools:        tools,
				ToolChoice:   toolChoiceForTools(tools),
				WebSearch:    buildProviderWebSearchOptions(input.WebSearch),
				Advanced:     input.Advanced,
			},
			func(delta ChatGenerationDelta) error {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				accumulatedThinking += delta.Thinking
				accumulatedText += delta.Text
				accumulatedToolCalls = mergeProviderToolCalls(accumulatedToolCalls, delta.ToolCalls)
				for progressIndex := range delta.ToolProgress {
					progress := &delta.ToolProgress[progressIndex]
					if progress.Status == "running" {
						toolProgressStartedAt[progress.ID] = time.Now()
					}
					if progress.Status == "completed" {
						if startedAt, ok := toolProgressStartedAt[progress.ID]; ok {
							progress.DurationMS = maxInt64(1, time.Since(startedAt).Milliseconds())
						}
					}
				}
				accumulatedToolProgress = mergeProviderToolProgress(accumulatedToolProgress, delta.ToolProgress)
				content := buildAssistantStreamingContent(accumulatedThinking, accumulatedText, accumulatedToolCalls, accumulatedToolProgress)
				if len(content) == 0 {
					return nil
				}
				service.broker.Publish(
					record.SessionID,
					buildRunEvent(record, session, "delta", "", buildAssistantMessageWithLineage(assistantMessageID, displayModel, assistantTimestamp, content, record.ID, roundIndex)),
				)
				return nil
			},
		)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				content := buildAssistantContent(accumulatedThinking, accumulatedText, accumulatedToolCalls)
				if len(accumulatedToolCalls) == 0 && len(content) > 0 {
					service.publishRunAborted(ctx, record, session, buildAssistantMessageWithLineage(assistantMessageID, displayModel, assistantTimestamp, content, record.ID, roundIndex))
					return
				}
				service.publishRunAborted(ctx, record, session, nil)
				return
			}
			service.publishRunError(ctx, record, session, err)
			return
		}
		if abortIfCanceled() {
			return
		}

		displayModel = displayModel.withProviderResult(result)
		accumulatedThinking = firstNonEmpty(result.ThinkingText, accumulatedThinking)
		if progressDetails := providerToolProgressDetails(accumulatedToolProgress); len(progressDetails) > 0 {
			if result.Details == nil {
				result.Details = make(map[string]any)
			}
			result.Details["hermesToolProgress"] = progressDetails
		}
		accumulatedToolCalls = mergeProviderToolCalls(accumulatedToolCalls, result.ToolCalls)
		assistantMessage := buildAssistantMessageWithLineage(
			assistantMessageID,
			displayModel,
			assistantTimestamp,
			buildAssistantContent(accumulatedThinking, result.OutputText, accumulatedToolCalls),
			record.ID,
			roundIndex,
		)
		if generationDetails := buildGenerationDetails(result); generationDetails != nil {
			assistantMessage["details"] = generationDetails
		}

		if len(result.ToolCalls) == 0 {
			sessionSummary, completed, err := service.completeRunWithFinalMessage(
				context.Background(),
				record,
				session,
				assistantMessage,
				assistantTimestamp,
				result.TotalTokens,
			)
			if err != nil {
				service.publishRunError(context.Background(), record, session, err)
				return
			}
			if !completed {
				service.publishRunAborted(context.Background(), record, session, nil)
				return
			}
			if result.TotalTokens > 0 {
				session.TotalTokens = result.TotalTokens
			}
			service.broker.Publish(record.SessionID, buildRunEventWithSession(record, session, "final", "", assistantMessage, &sessionSummary))
			return
		}

		stagedMessages := []map[string]any{assistantMessage}
		providerToolMessages := make([]ProviderMessage, 0, len(result.ToolCalls))
		limitExceeded := false
		for callIndex, call := range result.ToolCalls {
			messageIndex := callIndex + 1
			if executedToolCalls >= toolCallLimit {
				limitExceeded = true
				toolErr := fmt.Errorf("maximum tool calls exceeded (%d)", toolCallLimit)
				toolMessage := buildToolResultMessageWithLineage(newID(), call, WebToolResult{}, toolErr, newTimestamp(), 0, record.ID, roundIndex, messageIndex)
				stagedMessages = append(stagedMessages, toolMessage)
				providerToolMessages = append(providerToolMessages, providerToolResultMessage(call, WebToolResult{}, toolErr))
				continue
			}

			startedAt := time.Now()
			toolResult, toolErr := toolRuntime.Execute(ctx, call)
			if ctx.Err() != nil || errors.Is(toolErr, context.Canceled) {
				service.publishRunAborted(ctx, record, session, nil)
				return
			}
			duration := time.Since(startedAt)
			executedToolCalls++
			toolMessage := buildToolResultMessageWithLineage(
				newID(),
				call,
				toolResult,
				toolErr,
				newTimestamp(),
				maxInt64(1, duration.Milliseconds()),
				record.ID,
				roundIndex,
				messageIndex,
			)
			stagedMessages = append(stagedMessages, toolMessage)
			providerToolMessages = append(providerToolMessages, providerToolResultMessage(call, toolResult, toolErr))
		}
		if abortIfCanceled() {
			return
		}
		sessionSummary, committed, err := service.appendStagedRunMessagesIfRunning(context.Background(), record, session, stagedMessages, appendMessageOptions{SkipDerivedTitle: true})
		if err != nil {
			service.publishRunError(context.Background(), record, session, err)
			return
		}
		if !committed {
			service.publishRunAborted(context.Background(), record, session, nil)
			return
		}
		session.TotalTokens = sessionSummary.TotalTokens
		if result.TotalTokens > 0 && !updateTotalTokens(result.TotalTokens) {
			return
		}
		for _, message := range stagedMessages {
			service.broker.Publish(record.SessionID, buildRunEvent(record, session, "delta", "", message))
		}
		if limitExceeded {
			service.publishRunError(context.Background(), record, session, fmt.Errorf("maximum tool calls exceeded (%d)", toolCallLimit))
			return
		}

		messages = append(messages, ProviderMessage{Role: "assistant", Parts: providerPartsFromResult(result)})
		messages = append(messages, providerToolMessages...)
		assistantMessageID = newID()
	}
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
