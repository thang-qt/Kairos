package server

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"
)

var errGenerationInactive = errors.New("generation is no longer active")

type generationSink interface {
	ModelResolved(model ProviderModel) error
	ModelStarted() error
	Delta(message map[string]any) error
	ToolRound(messages []map[string]any, totalTokens int64) error
	ToolCompleted(message map[string]any) error
	Final(message map[string]any, totalTokens int64) error
}

type generationExecutionInput struct {
	AcceptedAt      int64
	UserID          string
	RunID           string
	AssistantTurnID string
	History         []map[string]any
	Request         SubmitTurnInput
}

func (service *AgentRuntime) executeGeneration(
	ctx context.Context,
	input generationExecutionInput,
	sink generationSink,
) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}

	resolutionStarted := time.Now()
	provider, model, _, err := service.providers.ResolveGenerationTarget(
		ctx,
		input.UserID,
		normalizeModel(input.Request.Model),
	)
	if err != nil {
		return err
	}
	if err := validateReasoningOptions(model, input.Request.Advanced); err != nil {
		return err
	}
	log.Printf("kairos: stage=provider_resolution run=%s duration_ms=%d", input.RunID, time.Since(resolutionStarted).Milliseconds())
	if err := sink.ModelResolved(model); err != nil {
		return err
	}
	driver := service.providers.drivers[provider.Record.Kind]
	if driver == nil {
		return fmt.Errorf(
			"unsupported provider kind: %s",
			provider.Record.Kind,
		)
	}

	effectiveSystemPrompt := buildEffectiveSystemPrompt(
		input.Request.SystemPrompt,
		firstNonEmpty(model.Name, model.ID),
		time.Now(),
		input.Request.ClientTime,
		input.Request.ClientTimeZone,
	)
	resolvedHistory, err := service.conversations.assets.resolveHistory(ctx, input.UserID, input.History)
	if err != nil {
		return err
	}
	providerMessages := buildProviderMessages(
		resolvedHistory,
		effectiveSystemPrompt,
	)
	tools := buildRuntimeTools(
		input.Request.WebSearch,
		input.Request.MathTools,
	)
	toolRuntime := toolExecutor(NewWebToolRuntimeFromEnv())
	if service.toolRuntime != nil {
		input.Request.ExecutionID = input.RunID
		resolvedRuntime, runtimeErr := service.toolRuntime(
			ctx,
			input.UserID,
			input.Request,
		)
		err = runtimeErr
		if err != nil {
			return err
		}
		if resolvedRuntime != nil {
			toolRuntime = resolvedRuntime
		}
	}

	if registry, ok := toolRuntime.(interface{ Definitions() []ProviderTool }); ok {
		tools = append(tools, registry.Definitions()...)
	}

	toolCallLimit := defaultMaxToolCalls
	if len(tools) > 0 && service.webSettings != nil {
		toolCallLimit, err = service.webSettings.ResolveToolCallLimit(
			ctx,
			input.UserID,
		)
		if err != nil {
			return err
		}
	}

	if len(tools) > mcpMaxEnabledTools+4 {
		return fmt.Errorf("too many enabled tools for this run")
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
	assistantMessageID := input.AssistantTurnID
	for roundIndex := 0; ; roundIndex++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if assistantMessageID == "" {
			assistantMessageID = newID()
		}
		assistantTimestamp := nextMessageTimestamp()
		var textBuffer generationTextBuffer
		accumulatedToolCalls := []ProviderToolCall{}
		if err := sink.ModelStarted(); err != nil {
			return err
		}
		log.Printf("kairos: stage=provider_request run=%s round=%d", input.RunID, roundIndex)
		providerStarted := time.Now()
		firstEvent := true
		firstVisible := true
		result, generationErr := generateWithRetry(
			ctx,
			driver,
			provider,
			ChatGenerationRequest{
				Model:        model.ID,
				SystemPrompt: effectiveSystemPrompt,
				Messages:     providerMessages,
				Tools:        tools,
				ToolChoice:   toolChoiceForTools(tools),
				Advanced:     input.Request.Advanced,
			},
			executedToolCalls == 0,
			func(delta ChatGenerationDelta) error {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if firstEvent {
					log.Printf("kairos: stage=first_provider_event run=%s latency_ms=%d", input.RunID, time.Since(providerStarted).Milliseconds())
					firstEvent = false
				}
				if firstVisible && delta.Text != "" {
					log.Printf("kairos: stage=first_text run=%s provider_ms=%d accepted_ms=%d", input.RunID, time.Since(providerStarted).Milliseconds(), time.Now().UnixMilli()-input.AcceptedAt)
					firstVisible = false
				}
				textBuffer.add(delta)
				if len(delta.ToolCalls) > 0 {
					accumulatedToolCalls = mergeProviderToolCalls(accumulatedToolCalls, delta.ToolCalls)
				}
				// Gate construction, not just persistence, for throttled sinks.
				if checkpoint, ok := sink.(interface{ CheckpointDue() bool }); ok && !checkpoint.CheckpointDue() {
					return nil
				}
				content := buildAssistantContent(textBuffer.thinking.String(), textBuffer.text.String(), accumulatedToolCalls, textBuffer.snapshotSegments()...)
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
			message := buildAssistantMessageWithLineage(assistantMessageID, displayModel, assistantTimestamp, buildAssistantContent(textBuffer.thinking.String(), textBuffer.text.String(), accumulatedToolCalls, textBuffer.snapshotSegments()...), input.RunID, roundIndex)
			message["details"] = buildGenerationDetails(result)
			if flush, ok := sink.(interface{ FlushDelta(map[string]any) error }); ok {
				if err := flush.FlushDelta(message); err != nil {
					return err
				}
			} else if err := sink.Delta(message); err != nil {
				return err
			}
			return generationErr
		}

		if ctx.Err() != nil {
			return ctx.Err()
		}

		deriveResultPhases(&result)
		displayModel = displayModel.withProviderResult(result)
		accumulatedThinking := firstNonEmpty(result.ThinkingText, textBuffer.thinking.String())
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
				result.TextSegments...,
			),
			input.RunID,
			roundIndex,
		)
		if generationDetails := buildGenerationDetails(result); generationDetails != nil {
			assistantMessage["details"] = generationDetails
		}
		if len(result.ToolCalls) == 0 {
			return sink.Final(
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

			if fence, ok := sink.(interface {
				BeforeTool(map[string]any, ProviderToolCall) error
			}); ok {
				if err := fence.BeforeTool(assistantMessage, call); err != nil {
					return err
				}
			}
			log.Printf("kairos: stage=tool_start run=%s call=%s", input.RunID, call.ID)
			startedAt := time.Now()
			toolResult, toolErr := toolRuntime.Execute(ctx, call)
			if ctx.Err() != nil || errors.Is(toolErr, context.Canceled) {
				return context.Canceled
			}
			log.Printf("kairos: stage=tool_completion run=%s call=%s duration_ms=%d", input.RunID, call.ID, time.Since(startedAt).Milliseconds())
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
			if err := sink.ToolCompleted(stagedMessages[len(stagedMessages)-1]); err != nil {
				return err
			}
			providerToolMessages = append(
				providerToolMessages,
				providerToolResultMessage(call, toolResult, toolErr),
			)
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := sink.ToolRound(stagedMessages, result.TotalTokens); err != nil {
			return err
		}
		if limitExceeded {
			return fmt.Errorf(
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
