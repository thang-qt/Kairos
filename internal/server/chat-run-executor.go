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
	provider, model, _, err := service.providers.ResolveGenerationTarget(ctx, record.UserID, record.Model)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			service.publishRunAborted(ctx, record, session, nil)
			return
		}
		service.publishRunError(ctx, record, session, err)
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
	appendMessage := func(message map[string]any, timestamp int64, skipDerivedTitle bool) (SessionSummary, error) {
		summary, err := service.chat.appendMessageWithOptions(
			ctx,
			session,
			message,
			timestamp,
			appendMessageOptions{SkipDerivedTitle: skipDerivedTitle},
		)
		if err == nil {
			session.TotalTokens = summary.TotalTokens
		}
		return summary, err
	}

	effectiveSystemPrompt := buildEffectiveSystemPrompt(input.SystemPrompt, history, time.Now(), input.ClientTime, input.ClientTimeZone)
	messages := buildProviderMessages(history, effectiveSystemPrompt)
	tools := buildRuntimeTools(input.WebSearch, input.MathTools)
	toolCallLimit := defaultMaxToolCalls
	if len(tools) > 0 && service.webSettings != nil {
		toolCallLimit, err = service.webSettings.ResolveToolCallLimit(ctx, record.UserID)
		if err != nil {
			service.publishRunError(ctx, record, session, err)
			return
		}
	}
	webRuntime := NewWebToolRuntimeFromEnv()
	if input.WebSearch && service.webSettings != nil {
		resolvedRuntime, runtimeErr := service.webSettings.ResolveRuntime(ctx, record.UserID)
		if runtimeErr != nil {
			service.publishRunError(ctx, record, session, runtimeErr)
			return
		}
		webRuntime = resolvedRuntime
	}

	assistantMessageID := record.AssistantMessageID
	var result ChatGenerationResult
	for round := 0; round < toolCallLimit; round++ {
		accumulatedText := ""
		accumulatedThinking := ""
		accumulatedToolCalls := []ProviderToolCall{}
		result, err = driver.GenerateChatStream(
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
				accumulatedThinking += delta.Thinking
				accumulatedText += delta.Text
				accumulatedToolCalls = mergeProviderToolCalls(accumulatedToolCalls, delta.ToolCalls)
				content := buildAssistantContent(accumulatedThinking, accumulatedText, accumulatedToolCalls)
				if len(content) == 0 {
					return nil
				}
				service.broker.Publish(
					record.SessionID,
					buildRunEvent(record, session, "delta", "", buildAssistantMessage(assistantMessageID, displayModel, newTimestamp(), content)),
				)
				return nil
			},
		)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				content := buildAssistantContent(accumulatedThinking, accumulatedText, accumulatedToolCalls)
				if len(content) == 0 {
					service.publishRunAborted(ctx, record, session, nil)
					return
				}
				service.publishRunAborted(ctx, record, session, buildAssistantMessage(assistantMessageID, displayModel, newTimestamp(), content))
				return
			}
			service.publishRunError(ctx, record, session, err)
			return
		}

		displayModel = displayModel.withProviderResult(result)
		accumulatedThinking = firstNonEmpty(result.ThinkingText, accumulatedThinking)
		accumulatedToolCalls = mergeProviderToolCalls(accumulatedToolCalls, result.ToolCalls)
		assistantMessage := buildAssistantMessage(
			assistantMessageID,
			displayModel,
			newTimestamp(),
			buildAssistantContent(accumulatedThinking, result.OutputText, accumulatedToolCalls),
		)
		if generationDetails := buildGenerationDetails(result); generationDetails != nil {
			assistantMessage["details"] = generationDetails
		}

		if len(result.ToolCalls) == 0 {
			sessionSummary, err := appendMessage(assistantMessage, int64Value(assistantMessage["timestamp"]), false)
			if err != nil {
				service.publishRunError(ctx, record, session, err)
				return
			}
			if result.TotalTokens > 0 {
				if err := service.chat.UpdateSessionTotalTokens(ctx, session.ID, session.UserID, result.TotalTokens); err != nil {
					service.publishRunError(ctx, record, session, err)
					return
				}
				session.TotalTokens = result.TotalTokens
				sessionSummary.TotalTokens = result.TotalTokens
			}
			completedAt := int64Value(assistantMessage["timestamp"])
			if err := service.markRunCompleted(ctx, record.ID, completedAt); err != nil {
				service.publishRunError(ctx, record, session, err)
				return
			}
			service.broker.Publish(record.SessionID, buildRunEventWithSession(record, session, "final", "", assistantMessage, &sessionSummary))
			return
		}

		if _, err := appendMessage(assistantMessage, int64Value(assistantMessage["timestamp"]), true); err != nil {
			service.publishRunError(ctx, record, session, err)
			return
		}
		service.broker.Publish(record.SessionID, buildRunEvent(record, session, "delta", "", assistantMessage))
		messages = append(messages, ProviderMessage{Role: "assistant", Parts: providerPartsFromResult(result)})

		for _, call := range result.ToolCalls {
			startedAt := time.Now()
			toolResult, toolErr := webRuntime.Execute(ctx, call)
			duration := time.Since(startedAt)
			toolMessage := buildToolResultMessage(
				newID(),
				call,
				toolResult,
				toolErr,
				newTimestamp(),
				maxInt64(1, duration.Milliseconds()),
			)
			if _, err := appendMessage(toolMessage, int64Value(toolMessage["timestamp"]), true); err != nil {
				service.publishRunError(ctx, record, session, err)
				return
			}
			service.broker.Publish(record.SessionID, buildRunEvent(record, session, "delta", "", toolMessage))
			messages = append(messages, providerToolResultMessage(call, toolResult, toolErr))
		}
		assistantMessageID = newID()
	}

	service.publishRunError(ctx, record, session, fmt.Errorf("tool loop exceeded maximum tool-call rounds (%d)", toolCallLimit))
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
	if err := service.markRunFailed(ctx, record.ID, runErr); err != nil {
		log.Printf("kairos: failed to persist run error for run %s: %v", record.ID, err)
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
	if err := service.markRunAborted(persistCtx, record.ID); err != nil {
		log.Printf("kairos: failed to persist run abort for run %s: %v", record.ID, err)
	}
	service.broker.Publish(record.SessionID, buildRunEventWithSession(record, session, "aborted", "", message, sessionSummary))
}

func (service *ChatRunService) markRunCompleted(ctx context.Context, runID string, completedAt int64) error {
	if _, err := service.db.ExecContext(ctx, `
		UPDATE chat_runs
		SET status = 'completed', completed_at = ?, error_message = NULL
		WHERE id = ?
	`, completedAt, runID); err != nil {
		return fmt.Errorf("complete run: %w", err)
	}
	return nil
}

func (service *ChatRunService) markRunFailed(ctx context.Context, runID string, runErr error) error {
	if _, err := service.db.ExecContext(ctx, `
		UPDATE chat_runs
		SET status = 'error', completed_at = ?, error_message = ?
		WHERE id = ?
	`, time.Now().UnixMilli(), strings.TrimSpace(runErr.Error()), runID); err != nil {
		return fmt.Errorf("fail run: %w", err)
	}
	return nil
}

func (service *ChatRunService) markRunAborted(ctx context.Context, runID string) error {
	if _, err := service.db.ExecContext(ctx, `
		UPDATE chat_runs
		SET status = 'aborted', completed_at = ?, error_message = NULL
		WHERE id = ?
	`, time.Now().UnixMilli(), runID); err != nil {
		return fmt.Errorf("abort run: %w", err)
	}
	return nil
}

func (service *ChatRunService) registerRunCancel(record runRecord, cancel context.CancelFunc) {
	service.runMu.Lock()
	defer service.runMu.Unlock()
	service.runCancels[record.ID] = cancel
	if service.sessionRuns[record.SessionID] == nil {
		service.sessionRuns[record.SessionID] = make(map[string]struct{})
	}
	service.sessionRuns[record.SessionID][record.ID] = struct{}{}
}

func (service *ChatRunService) unregisterRunCancel(record runRecord) {
	service.runMu.Lock()
	defer service.runMu.Unlock()
	delete(service.runCancels, record.ID)
	sessionRuns := service.sessionRuns[record.SessionID]
	if sessionRuns == nil {
		return
	}
	delete(sessionRuns, record.ID)
	if len(sessionRuns) == 0 {
		delete(service.sessionRuns, record.SessionID)
	}
}
