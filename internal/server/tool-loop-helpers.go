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

func webToolEventDetails(call ProviderToolCall, result WebToolResult, toolErr error) map[string]any {
	event := map[string]any{
		"id":        strings.TrimSpace(call.ID),
		"name":      strings.TrimSpace(call.Name),
		"arguments": call.Args,
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
