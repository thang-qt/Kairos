package server

import "strings"

func toolChoiceForTools(tools []ProviderTool) any {
	if len(tools) == 0 {
		return nil
	}
	return "auto"
}

func providerPartsFromResult(result ChatGenerationResult) []ProviderMessagePart {
	parts := make([]ProviderMessagePart, 0, 2+len(result.ToolCalls))
	if text := strings.TrimSpace(result.OutputText); text != "" {
		parts = append(parts, ProviderMessagePart{Type: "text", Text: text})
	}
	for _, call := range result.ToolCalls {
		parts = append(parts, ProviderMessagePart{
			Type:     "toolCall",
			ID:       strings.TrimSpace(call.ID),
			Name:     strings.TrimSpace(call.Name),
			ArgsJSON: strings.TrimSpace(call.ArgsJSON),
			Args:     call.Args,
		})
	}
	// Some models (e.g. extended-thinking on Anthropic) can return a round
	// with no output text and no tool calls — only a thinking block. Sending
	// an empty assistant turn back to the provider causes it to reject the
	// next request with "model output must contain either output text or tool
	// calls". Insert a minimal placeholder so the turn is always non-empty.
	if len(parts) == 0 {
		parts = append(parts, ProviderMessagePart{Type: "text", Text: "..."})
	}
	return parts
}

func providerToolResultMessage(call ProviderToolCall, result WebToolResult, toolErr error) ProviderMessage {
	return providerToolResultMessageFromText(call, canonicalToolResultText(result, toolErr))
}

func providerToolResultMessageFromText(call ProviderToolCall, text string) ProviderMessage {
	return ProviderMessage{
		Role:       "tool",
		ToolCallID: strings.TrimSpace(call.ID),
		Parts: []ProviderMessagePart{{
			Type: "text",
			Text: strings.TrimSpace(text),
		}},
	}
}

func canonicalToolResultText(result WebToolResult, toolErr error) string {
	if toolErr != nil {
		return strings.TrimSpace(toolErr.Error())
	}
	return strings.TrimSpace(result.Content)
}

func buildToolResultMessage(
	messageID string,
	call ProviderToolCall,
	result WebToolResult,
	toolErr error,
	timestamp int64,
	durationMs int64,
) map[string]any {
	return buildToolResultMessageWithLineage(
		messageID,
		call,
		result,
		toolErr,
		timestamp,
		durationMs,
		"",
		-1,
		-1,
	)
}

func buildToolResultMessageWithLineage(
	messageID string,
	call ProviderToolCall,
	result WebToolResult,
	toolErr error,
	timestamp int64,
	durationMs int64,
	runID string,
	roundIndex int,
	messageIndex int,
) map[string]any {
	message := chatMessage{
		ID:         messageID,
		Role:       "toolResult",
		RunID:      strings.TrimSpace(runID),
		Timestamp:  timestamp,
		Content:    []chatMessageContentPart{newTextContentPart(canonicalToolResultText(result, toolErr))},
		Details:    toolResultDetails(call, result, toolErr, durationMs),
		ToolCallID: strings.TrimSpace(call.ID),
		ToolName:   strings.TrimSpace(call.Name),
		IsError:    toolErr != nil,
	}
	if roundIndex >= 0 {
		message.RoundIndex = intPointer(roundIndex)
	}
	if messageIndex >= 0 {
		message.MessageIndex = intPointer(messageIndex)
	}
	return message.toMap()
}

func toolResultDetails(
	call ProviderToolCall,
	result WebToolResult,
	toolErr error,
	durationMs int64,
) map[string]any {
	if !isWebToolName(call.Name) {
		details := make(map[string]any, len(result.Details)+1)
		for key, value := range result.Details {
			details[key] = value
		}
		if durationMs > 0 {
			details["durationMs"] = durationMs
		}
		return details
	}
	event := map[string]any{
		"id":        strings.TrimSpace(call.ID),
		"name":      strings.TrimSpace(call.Name),
		"arguments": call.Args,
	}
	if durationMs > 0 {
		event["durationMs"] = durationMs
	}
	if toolErr != nil {
		event["error"] = strings.TrimSpace(toolErr.Error())
	} else {
		event["result"] = result.Details
	}
	return map[string]any{"webTools": []map[string]any{event}}
}

func isWebToolName(name string) bool {
	switch strings.TrimSpace(name) {
	case webSearchToolName, webFetchToolName:
		return true
	default:
		return false
	}
}
