package server

import (
	"context"
	"errors"
	"fmt"
	"time"
)

var errGenerationInactive = errors.New("generation is no longer active")

type generationOutcome struct {
	PartialMessage map[string]any
}

type generationSink interface {
	ModelResolved(model ProviderModel) error
	Delta(message map[string]any) error
	ToolRound(messages []map[string]any, totalTokens int64) error
	Final(message map[string]any, totalTokens int64) error
}

type generationExecutionInput struct {
	UserID             string
	RunID              string
	AssistantMessageID string
	History            []map[string]any
	Request            SendMessageInput
}

func (service *ChatRunService) executeGeneration(
	ctx context.Context,
	input generationExecutionInput,
	sink generationSink,
) (generationOutcome, error) {
	if ctx.Err() != nil {
		return generationOutcome{}, ctx.Err()
	}

	provider, model, _, err := service.providers.ResolveGenerationTarget(
		ctx,
		input.UserID,
		normalizeModel(input.Request.Model),
	)
	if err != nil {
		return generationOutcome{}, err
	}
	if err := sink.ModelResolved(model); err != nil {
		return generationOutcome{}, err
	}
	driver := service.providers.drivers[provider.Record.Kind]
	if driver == nil {
		return generationOutcome{}, fmt.Errorf(
			"unsupported provider kind: %s",
			provider.Record.Kind,
		)
	}

	effectiveSystemPrompt := buildEffectiveSystemPrompt(
		input.Request.SystemPrompt,
		input.History,
		time.Now(),
		input.Request.ClientTime,
		input.Request.ClientTimeZone,
	)
	providerMessages := buildProviderMessages(
		input.History,
		effectiveSystemPrompt,
	)
	tools := buildRuntimeTools(
		input.Request.WebSearch,
		input.Request.MathTools,
	)
	toolCallLimit := defaultMaxToolCalls
	if len(tools) > 0 && service.webSettings != nil {
		toolCallLimit, err = service.webSettings.ResolveToolCallLimit(
			ctx,
			input.UserID,
		)
		if err != nil {
			return generationOutcome{}, err
		}
	}
	toolRuntime := toolExecutor(NewWebToolRuntimeFromEnv())
	if service.toolRuntime != nil {
		resolvedRuntime, runtimeErr := service.toolRuntime(
			ctx,
			input.UserID,
			input.Request,
		)
		err = runtimeErr
		if err != nil {
			return generationOutcome{}, err
		}
		if resolvedRuntime != nil {
			toolRuntime = resolvedRuntime
		}
	}

	displayModel := assistantModelDisplay{
		ID:          model.ID,
		Name:        firstNonEmpty(model.Name, model.ID),
		Description: provider.Record.Label,
	}
	nextTimestamp := latestMessageTimestamp(input.History) + 1
	nextMessageTimestamp := func() int64 {
		timestamp := maxInt64(time.Now().UnixMilli(), nextTimestamp)
		nextTimestamp = timestamp + 1
		return timestamp
	}

	executedToolCalls := 0
	assistantMessageID := input.AssistantMessageID
	for roundIndex := 0; ; roundIndex++ {
		if ctx.Err() != nil {
			return generationOutcome{}, ctx.Err()
		}
		if assistantMessageID == "" {
			assistantMessageID = newID()
		}
		assistantTimestamp := nextMessageTimestamp()
		accumulatedText := ""
		accumulatedThinking := ""
		accumulatedToolCalls := []ProviderToolCall{}
		accumulatedToolProgress := []ProviderToolProgress{}
		toolProgressStartedAt := make(map[string]time.Time)
		result, generationErr := driver.GenerateChatStream(
			ctx,
			provider,
			ChatGenerationRequest{
				Model:        model.ID,
				SystemPrompt: effectiveSystemPrompt,
				Messages:     providerMessages,
				Tools:        tools,
				ToolChoice:   toolChoiceForTools(tools),
				WebSearch: buildProviderWebSearchOptions(
					input.Request.WebSearch,
				),
				Advanced: input.Request.Advanced,
			},
			func(delta ChatGenerationDelta) error {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				accumulatedThinking += delta.Thinking
				accumulatedText += delta.Text
				accumulatedToolCalls = mergeProviderToolCalls(
					accumulatedToolCalls,
					delta.ToolCalls,
				)
				for progressIndex := range delta.ToolProgress {
					progress := &delta.ToolProgress[progressIndex]
					if progress.Status == "running" {
						toolProgressStartedAt[progress.ID] = time.Now()
					}
					if progress.Status == "completed" {
						if startedAt, ok := toolProgressStartedAt[progress.ID]; ok {
							progress.DurationMS = maxInt64(
								1,
								time.Since(startedAt).Milliseconds(),
							)
						}
					}
				}
				accumulatedToolProgress = mergeProviderToolProgress(
					accumulatedToolProgress,
					delta.ToolProgress,
				)
				content := buildAssistantStreamingContent(
					accumulatedThinking,
					accumulatedText,
					accumulatedToolCalls,
					accumulatedToolProgress,
				)
				if len(content) == 0 {
					return nil
				}
				return sink.Delta(buildAssistantMessageWithLineage(
					assistantMessageID,
					displayModel,
					assistantTimestamp,
					content,
					input.RunID,
					roundIndex,
				))
			},
		)
		if generationErr != nil {
			content := buildAssistantContent(
				accumulatedThinking,
				accumulatedText,
				accumulatedToolCalls,
			)
			outcome := generationOutcome{}
			if errors.Is(generationErr, context.Canceled) &&
				len(accumulatedToolCalls) == 0 &&
				len(content) > 0 {
				outcome.PartialMessage = buildAssistantMessageWithLineage(
					assistantMessageID,
					displayModel,
					assistantTimestamp,
					content,
					input.RunID,
					roundIndex,
				)
			}
			return outcome, generationErr
		}
		if ctx.Err() != nil {
			return generationOutcome{}, ctx.Err()
		}

		displayModel = displayModel.withProviderResult(result)
		accumulatedThinking = firstNonEmpty(
			result.ThinkingText,
			accumulatedThinking,
		)
		if progressDetails := providerToolProgressDetails(
			accumulatedToolProgress,
		); len(progressDetails) > 0 {
			if result.Details == nil {
				result.Details = make(map[string]any)
			}
			result.Details["hermesToolProgress"] = progressDetails
		}
		accumulatedToolCalls = mergeProviderToolCalls(
			accumulatedToolCalls,
			result.ToolCalls,
		)
		assistantMessage := buildAssistantMessageWithLineage(
			assistantMessageID,
			displayModel,
			assistantTimestamp,
			buildAssistantContent(
				accumulatedThinking,
				result.OutputText,
				accumulatedToolCalls,
			),
			input.RunID,
			roundIndex,
		)
		if generationDetails := buildGenerationDetails(result); generationDetails != nil {
			assistantMessage["details"] = generationDetails
		}
		if len(result.ToolCalls) == 0 {
			return generationOutcome{}, sink.Final(
				assistantMessage,
				result.TotalTokens,
			)
		}

		stagedMessages := []map[string]any{assistantMessage}
		providerToolMessages := make(
			[]ProviderMessage,
			0,
			len(result.ToolCalls),
		)
		limitExceeded := false
		for callIndex, call := range result.ToolCalls {
			messageIndex := callIndex + 1
			if executedToolCalls >= toolCallLimit {
				limitExceeded = true
				toolErr := fmt.Errorf(
					"maximum tool calls exceeded (%d)",
					toolCallLimit,
				)
				stagedMessages = append(
					stagedMessages,
					buildToolResultMessageWithLineage(
						newID(),
						call,
						WebToolResult{},
						toolErr,
						nextMessageTimestamp(),
						0,
						input.RunID,
						roundIndex,
						messageIndex,
					),
				)
				providerToolMessages = append(
					providerToolMessages,
					providerToolResultMessage(
						call,
						WebToolResult{},
						toolErr,
					),
				)
				continue
			}

			startedAt := time.Now()
			toolResult, toolErr := toolRuntime.Execute(ctx, call)
			if ctx.Err() != nil || errors.Is(toolErr, context.Canceled) {
				return generationOutcome{}, context.Canceled
			}
			executedToolCalls++
			stagedMessages = append(
				stagedMessages,
				buildToolResultMessageWithLineage(
					newID(),
					call,
					toolResult,
					toolErr,
					nextMessageTimestamp(),
					maxInt64(1, time.Since(startedAt).Milliseconds()),
					input.RunID,
					roundIndex,
					messageIndex,
				),
			)
			providerToolMessages = append(
				providerToolMessages,
				providerToolResultMessage(call, toolResult, toolErr),
			)
		}
		if ctx.Err() != nil {
			return generationOutcome{}, ctx.Err()
		}
		if err := sink.ToolRound(stagedMessages, result.TotalTokens); err != nil {
			return generationOutcome{}, err
		}
		if limitExceeded {
			return generationOutcome{}, fmt.Errorf(
				"maximum tool calls exceeded (%d)",
				toolCallLimit,
			)
		}

		providerMessages = append(
			providerMessages,
			ProviderMessage{
				Role:  "assistant",
				Parts: providerPartsFromResult(result),
			},
		)
		providerMessages = append(providerMessages, providerToolMessages...)
		assistantMessageID = newID()
	}
}
