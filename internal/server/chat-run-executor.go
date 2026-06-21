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
		service.publishRunError(
			ctx,
			record,
			session,
			fmt.Errorf("unsupported provider kind: %s", provider.Record.Kind),
		)
		return
	}

	accumulatedText := ""
	accumulatedThinking := ""
	accumulatedToolCalls := []ProviderToolCall{}
	displayModel := assistantModelDisplay{
		ID:          model.ID,
		Name:        firstNonEmpty(model.Name, model.ID),
		Description: provider.Record.Label,
	}
	minAssistantTimestamp := latestMessageTimestamp(history) + 1
	result, err := driver.GenerateChatStream(
		ctx,
		provider,
		ChatGenerationRequest{
			Model:        model.ID,
			SystemPrompt: input.SystemPrompt,
			WebSearch:    buildProviderWebSearchOptions(input.WebSearch),
			Messages:     buildProviderMessages(history, input.SystemPrompt),
			Advanced:     input.Advanced,
		},
		func(delta ChatGenerationDelta) error {
			if delta.Thinking != "" {
				accumulatedThinking += delta.Thinking
			}
			if delta.Text != "" {
				accumulatedText += delta.Text
			}
			if len(delta.ToolCalls) > 0 {
				accumulatedToolCalls = mergeProviderToolCalls(
					accumulatedToolCalls,
					delta.ToolCalls,
				)
			}
			content := buildAssistantContent(accumulatedThinking, accumulatedText, accumulatedToolCalls)
			if len(content) == 0 {
				return nil
			}
			service.broker.Publish(
				record.SessionID,
				buildRunEvent(
					record,
					session,
					"delta",
					"",
					buildAssistantMessage(
						record.AssistantMessageID,
						displayModel,
						time.Now().UnixMilli(),
						content,
					),
				),
			)
			return nil
		},
	)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			abortedTimestamp := maxInt64(time.Now().UnixMilli(), minAssistantTimestamp)
			abortedMessage := buildAssistantMessage(
				record.AssistantMessageID,
				displayModel,
				abortedTimestamp,
				buildAssistantContent(accumulatedThinking, accumulatedText, accumulatedToolCalls),
			)
			service.publishRunAborted(ctx, record, session, abortedMessage)
			return
		}
		service.publishRunError(ctx, record, session, err)
		return
	}
	displayModel = displayModel.withProviderResult(result)
	accumulatedThinking = firstNonEmpty(result.ThinkingText, accumulatedThinking)
	accumulatedToolCalls = mergeProviderToolCalls(accumulatedToolCalls, result.ToolCalls)

	finalTimestamp := maxInt64(time.Now().UnixMilli(), minAssistantTimestamp)
	finalMessage := buildAssistantMessage(
		record.AssistantMessageID,
		displayModel,
		finalTimestamp,
		buildAssistantContent(accumulatedThinking, result.OutputText, accumulatedToolCalls),
	)
	if generationDetails := buildGenerationDetails(result); generationDetails != nil {
		finalMessage["details"] = generationDetails
	}

	sessionSummary, err := service.chat.appendMessage(ctx, session, finalMessage, finalTimestamp)
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
	if err := service.markRunCompleted(ctx, record.ID, finalTimestamp); err != nil {
		service.publishRunError(ctx, record, session, err)
		return
	}

	service.broker.Publish(
		record.SessionID,
		buildRunEventWithSession(record, session, "final", "", finalMessage, &sessionSummary),
	)
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
	log.Printf(
		"kairos: run %s failed for session %s (%s): %s",
		record.ID,
		session.ID,
		session.FriendlyID,
		normalizedError,
	)
	service.broker.Publish(
		record.SessionID,
		buildRunEvent(record, session, "error", normalizedError, nil),
	)
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
	service.broker.Publish(
		record.SessionID,
		buildRunEventWithSession(record, session, "aborted", "", message, sessionSummary),
	)
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

func (service *ChatRunService) registerRunCancel(
	record runRecord,
	cancel context.CancelFunc,
) {
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
