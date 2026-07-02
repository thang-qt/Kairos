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

const maxToolLoopRounds = 12

type roundSummary struct {
	Round    int      `json:"round"`
	Text     string   `json:"text,omitempty"`
	Thinking string   `json:"thinking,omitempty"`
	ToolIDs  []string `json:"toolIds,omitempty"`
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
	messages := buildProviderMessages(history, input.SystemPrompt)
	tools := buildRuntimeTools(input.WebSearch, input.MathTools)
	webRuntime := NewWebToolRuntimeFromEnv()
	if input.WebSearch && service.webSettings != nil {
		resolvedRuntime, runtimeErr := service.webSettings.ResolveRuntime(ctx, record.UserID)
		if runtimeErr != nil {
			service.publishRunError(ctx, record, session, runtimeErr)
			return
		}
		webRuntime = resolvedRuntime
	}
	toolEvents := make([]map[string]any, 0)
	webToolEvents := make([]map[string]any, 0)
	persistedToolCalls := make([]ProviderToolCall, 0)
	roundSummaries := make([]roundSummary, 0)
	var result ChatGenerationResult
	for round := 0; round < maxToolLoopRounds; round++ {
		result, err = driver.GenerateChatStream(
			ctx,
			provider,
			ChatGenerationRequest{
				Model:        model.ID,
				SystemPrompt: input.SystemPrompt,
				Messages:     messages,
				Tools:        tools,
				ToolChoice:   toolChoiceForTools(tools),
				WebSearch:    buildProviderWebSearchOptions(input.WebSearch),
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
				displayText := accumulatedText
				content := buildAssistantContentWithToolCallsBeforeText(
					accumulatedThinking,
					displayText,
					mergeProviderToolCalls(persistedToolCalls, accumulatedToolCalls),
				)
				if len(persistedToolCalls) > 0 {
					content = buildAssistantToolLoopStreamingContent(
						roundSummaries,
						persistedToolCalls,
						accumulatedThinking,
						accumulatedToolCalls,
						displayText,
					)
				}
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
					buildAssistantContentWithToolCallsBeforeText(
						accumulatedThinking,
						accumulatedText,
						mergeProviderToolCalls(persistedToolCalls, accumulatedToolCalls),
					),
				)
				attachRunToolDetails(abortedMessage, toolEvents, webToolEvents, roundSummaries)
				service.publishRunAborted(ctx, record, session, abortedMessage)
				return
			}
			service.publishRunError(ctx, record, session, err)
			return
		}
		displayModel = displayModel.withProviderResult(result)
		accumulatedThinking = firstNonEmpty(result.ThinkingText, accumulatedThinking)
		accumulatedToolCalls = mergeProviderToolCalls(accumulatedToolCalls, result.ToolCalls)
		if len(result.ToolCalls) == 0 {
			break
		}
		persistedToolCalls = mergeProviderToolCalls(persistedToolCalls, result.ToolCalls)
		rsummary := roundSummary{Round: round}
		if t := strings.TrimSpace(accumulatedText); t != "" {
			rsummary.Text = t
		}
		if t := strings.TrimSpace(accumulatedThinking); t != "" {
			rsummary.Thinking = t
		}
		for _, call := range result.ToolCalls {
			if id := strings.TrimSpace(call.ID); id != "" {
				rsummary.ToolIDs = append(rsummary.ToolIDs, id)
			}
		}
		roundSummaries = append(roundSummaries, rsummary)
		messages = append(messages, ProviderMessage{Role: "assistant", Parts: providerPartsFromResult(result)})
		for _, call := range result.ToolCalls {
			toolStartedAt := time.Now().UnixMilli()
			toolResult, toolErr := webRuntime.Execute(ctx, call)
			toolFinishedAt := time.Now().UnixMilli()
			toolEvent := webToolEventDetails(call, toolResult, toolErr, toolStartedAt, toolFinishedAt)
			toolEvents = append(toolEvents, toolEvent)
			if isWebToolName(call.Name) {
				webToolEvents = append(webToolEvents, toolEvent)
			}
			messages = append(messages, providerToolResultMessage(call, toolResult, toolErr))
		}
		toolDeltaContent := buildAssistantToolLoopSnapshotContent(roundSummaries, persistedToolCalls)
		toolDeltaMessage := buildAssistantMessage(
			record.AssistantMessageID,
			displayModel,
			time.Now().UnixMilli(),
			toolDeltaContent,
		)
		attachRunToolDetails(toolDeltaMessage, toolEvents, webToolEvents, roundSummaries)
		service.broker.Publish(
			record.SessionID,
			buildRunEvent(record, session, "delta", "", toolDeltaMessage),
		)
		accumulatedText = ""
		accumulatedThinking = ""
		accumulatedToolCalls = nil
	}
	if len(result.ToolCalls) > 0 {
		service.publishRunError(ctx, record, session, fmt.Errorf("tool loop exceeded maximum rounds (%d)", maxToolLoopRounds))
		return
	}

	finalTimestamp := maxInt64(time.Now().UnixMilli(), minAssistantTimestamp)
	finalContent := buildAssistantContentWithToolCallsBeforeText(accumulatedThinking, result.OutputText, mergeProviderToolCalls(persistedToolCalls, accumulatedToolCalls))
	finalMessage := buildAssistantMessage(
		record.AssistantMessageID,
		displayModel,
		finalTimestamp,
		finalContent,
	)
	if generationDetails := buildGenerationDetails(result); generationDetails != nil {
		finalMessage["details"] = generationDetails
	}
	attachRunToolDetails(finalMessage, toolEvents, webToolEvents, roundSummaries)

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

func buildAssistantToolLoopSnapshotContent(
	summaries []roundSummary,
	toolCalls []ProviderToolCall,
) []chatMessageContentPart {
	return buildAssistantToolLoopStreamingContent(summaries, toolCalls, "", nil, "")
}

func buildAssistantToolLoopStreamingContent(
	summaries []roundSummary,
	priorToolCalls []ProviderToolCall,
	currentThinking string,
	currentToolCalls []ProviderToolCall,
	text string,
) []chatMessageContentPart {
	content := make([]chatMessageContentPart, 0, len(priorToolCalls)+len(currentToolCalls)+len(summaries)+2)
	consumedToolCalls := 0
	for _, summary := range summaries {
		if thinking := strings.TrimSpace(summary.Thinking); thinking != "" {
			content = append(content, newThinkingContentPart(thinking))
		}
		toolCount := len(summary.ToolIDs)
		if toolCount == 0 && consumedToolCalls < len(priorToolCalls) {
			toolCount = 1
		}
		for i := 0; i < toolCount && consumedToolCalls < len(priorToolCalls); i++ {
			toolCall := priorToolCalls[consumedToolCalls]
			consumedToolCalls++
			if providerToolCallIsEmpty(toolCall) {
				continue
			}
			content = append(content, newToolCallContentPart(toolCall))
		}
	}
	for consumedToolCalls < len(priorToolCalls) {
		toolCall := priorToolCalls[consumedToolCalls]
		consumedToolCalls++
		if providerToolCallIsEmpty(toolCall) {
			continue
		}
		content = append(content, newToolCallContentPart(toolCall))
	}
	if thinking := strings.TrimSpace(currentThinking); thinking != "" {
		content = append(content, newThinkingContentPart(thinking))
	}
	for _, toolCall := range currentToolCalls {
		if providerToolCallIsEmpty(toolCall) {
			continue
		}
		content = append(content, newToolCallContentPart(toolCall))
	}
	if normalizedText := strings.TrimSpace(text); normalizedText != "" {
		content = append(content, newTextContentPart(normalizedText))
	}
	return content
}

func providerToolCallIsEmpty(toolCall ProviderToolCall) bool {
	return strings.TrimSpace(toolCall.ID) == "" &&
		strings.TrimSpace(toolCall.Name) == "" &&
		strings.TrimSpace(toolCall.ArgsJSON) == "" &&
		len(toolCall.Args) == 0
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
