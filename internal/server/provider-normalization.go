package server

import (
	"encoding/json"
	"strings"
)

func normalizeReasoningEffort(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "none", "minimal", "low", "medium", "high", "xhigh", "max":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "medium"
	}
}

func clampFloat32(value float32, minValue float32, maxValue float32) float32 {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func clampInt(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func providerToolCallArguments(part ProviderMessagePart) string {
	if normalized := strings.TrimSpace(part.ArgsJSON); normalized != "" {
		return normalized
	}
	if len(part.Args) == 0 {
		return "{}"
	}
	encoded, err := json.Marshal(part.Args)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func parseToolCallArguments(value string) map[string]any {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return nil
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(normalized), &parsed); err != nil {
		return nil
	}
	return parsed
}

func providerToolCallsDetails(toolCalls []ProviderToolCall) []map[string]any {
	result := make([]map[string]any, 0, len(toolCalls))
	for _, toolCall := range toolCalls {
		value := map[string]any{
			"id":        toolCall.ID,
			"name":      toolCall.Name,
			"arguments": toolCall.Args,
		}
		if toolCall.ArgsJSON != "" {
			value["partialJson"] = toolCall.ArgsJSON
		}
		result = append(result, value)
	}
	return result
}
