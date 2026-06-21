package server

import (
	"encoding/json"
	"strings"
)

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
	payload := map[string]any{
		"tool": strings.TrimSpace(call.Name),
	}
	if toolErr != nil {
		payload["error"] = strings.TrimSpace(toolErr.Error())
	} else if result.Details != nil {
		payload["result"] = result.Details
	} else {
		payload["result"] = result.Content
	}
	encoded, _ := json.Marshal(payload)
	return ProviderMessage{
		Role:       "tool",
		ToolCallID: strings.TrimSpace(call.ID),
		Parts: []ProviderMessagePart{{
			Type: "text",
			Text: string(encoded),
		}},
	}
}

func isWebToolName(name string) bool {
	switch strings.TrimSpace(name) {
	case webSearchToolName, webFetchToolName:
		return true
	default:
		return false
	}
}

func buildRuntimeToolDetails(toolEvents []map[string]any, webToolEvents []map[string]any) map[string]any {
	details := make(map[string]any)
	if len(toolEvents) > 0 {
		details["tools"] = toolEvents
	}
	if len(webToolEvents) > 0 {
		details["webTools"] = webToolEvents
	}
	if len(details) == 0 {
		return nil
	}
	return details
}

func attachRunToolDetails(message map[string]any, toolEvents []map[string]any, webToolEvents []map[string]any, roundSummaries []roundSummary) {
	if len(message) == 0 {
		return
	}
	var details map[string]any
	if existing, ok := message["details"].(map[string]any); ok {
		details = existing
	} else {
		details = make(map[string]any)
	}
	if toolDetails := buildRuntimeToolDetails(toolEvents, webToolEvents); toolDetails != nil {
		for key, value := range toolDetails {
			details[key] = value
		}
	}
	if len(roundSummaries) > 0 {
		details["roundSummaries"] = roundSummaries
	}
	if len(details) > 0 {
		message["details"] = details
	}
}

func webToolEventDetails(call ProviderToolCall, result WebToolResult, toolErr error, startedAt int64, finishedAt int64) map[string]any {
	event := map[string]any{
		"id":        strings.TrimSpace(call.ID),
		"name":      strings.TrimSpace(call.Name),
		"arguments": call.Args,
	}
	if startedAt > 0 {
		event["startedAt"] = startedAt
	}
	if finishedAt > 0 {
		event["finishedAt"] = finishedAt
	}
	if startedAt > 0 && finishedAt >= startedAt {
		event["durationMs"] = finishedAt - startedAt
	}
	if strings.TrimSpace(call.ArgsJSON) != "" {
		event["partialJson"] = strings.TrimSpace(call.ArgsJSON)
	}
	if toolErr != nil {
		event["error"] = strings.TrimSpace(toolErr.Error())
		return event
	}
	if result.Details != nil {
		event["result"] = result.Details
	} else if strings.TrimSpace(result.Content) != "" {
		var decoded any
		if err := json.Unmarshal([]byte(result.Content), &decoded); err == nil {
			event["result"] = decoded
		} else {
			event["result"] = result.Content
		}
	}
	return event
}
