package server

import (
	"fmt"
	"strings"
	"time"
)

func buildEffectiveSystemPrompt(
	systemPrompt string,
	modelName string,
	now time.Time,
	clientTime string,
	clientTimeZone string,
) string {
	currentTime := formatRuntimeCurrentTime(now, clientTime, clientTimeZone)
	runtimeLines := []string{
		"Runtime context:",
		fmt.Sprintf("- Current time: %s.", currentTime),
	}
	runtimeLines = append(runtimeLines, fmt.Sprintf("- Current model: %s.", strings.TrimSpace(modelName)))

	promptSections := []string{"You are an AI assistant in Kairos, a lightweight AI chat client."}
	if normalizedSystemPrompt := strings.TrimSpace(systemPrompt); normalizedSystemPrompt != "" {
		promptSections = append(promptSections, normalizedSystemPrompt)
	}
	promptSections = append(promptSections, strings.Join(runtimeLines, "\n"))
	return strings.Join(promptSections, "\n\n")
}

func buildProviderMessages(
	history []map[string]any,
	systemPrompt string,
) []ProviderMessage {
	messages := make([]ProviderMessage, 0, len(history)+1)
	if normalizedSystemPrompt := strings.TrimSpace(systemPrompt); normalizedSystemPrompt != "" {
		messages = append(messages, ProviderMessage{
			Role: "system",
			Parts: []ProviderMessagePart{
				{
					Type: "text",
					Text: normalizedSystemPrompt,
				},
			},
		})
	}
	for _, message := range history {
		role := strings.TrimSpace(stringValueFromMap(message, "role"))
		if role == "toolResult" {
			role = "tool"
		}
		if role == "" {
			continue
		}
		parts := extractProviderMessageParts(message["content"])
		if len(parts) == 0 {
			continue
		}
		messages = append(messages, ProviderMessage{
			Role:       role,
			Parts:      parts,
			ToolCallID: strings.TrimSpace(stringValueFromMap(message, "toolCallId")),
		})
	}
	return messages
}

func extractProviderMessageParts(value any) []ProviderMessagePart {
	items := contentPartsFromAny(value)
	if len(items) == 0 {
		return nil
	}

	parts := make([]ProviderMessagePart, 0, len(items))
	for _, item := range items {
		switch strings.TrimSpace(item.Type) {
		case "text":
			if item.Text != "" {
				parts = append(parts, ProviderMessagePart{
					Type:        "text",
					Text:        item.Text,
					Phase:       item.Phase,
					PhaseSource: item.PhaseSource,
				})
			}
		case "image":
			if item.Source == nil || strings.TrimSpace(item.Source.Type) != "base64" {
				continue
			}
			mimeType := strings.TrimSpace(item.Source.MediaType)
			content := strings.TrimSpace(item.Source.Data)
			if mimeType == "" || content == "" {
				continue
			}
			parts = append(parts, ProviderMessagePart{
				Type:     "image",
				MimeType: mimeType,
				Content:  content,
			})
		case "toolCall":
			parts = append(parts, ProviderMessagePart{
				Type:     "toolCall",
				ID:       strings.TrimSpace(item.ID),
				Name:     strings.TrimSpace(item.Name),
				Args:     item.Args,
				ArgsJSON: strings.TrimSpace(item.ArgsJSON),
			})
		}
	}
	return parts
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func formatRuntimeCurrentTime(now time.Time, clientTime string, clientTimeZone string) string {
	parsedClientTime, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(clientTime))
	if err == nil {
		if location, loadErr := time.LoadLocation(strings.TrimSpace(clientTimeZone)); loadErr == nil {
			return fmt.Sprintf(
				"%s (%s, from the user's browser)",
				parsedClientTime.In(location).Format("2006-01-02 15:04:05 MST"),
				strings.TrimSpace(clientTimeZone),
			)
		}
		return parsedClientTime.UTC().Format("2006-01-02 15:04:05 MST") + " (from the user's browser)"
	}
	return now.UTC().Format("2006-01-02 15:04:05 MST") + " (server fallback)"
}
