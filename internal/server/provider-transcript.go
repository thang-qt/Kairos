package server

import (
	"fmt"
	"strings"
	"time"
)

func buildEffectiveSystemPrompt(
	systemPrompt string,
	history []map[string]any,
	now time.Time,
	clientTime string,
	clientTimeZone string,
) string {
	currentTime := formatRuntimeCurrentTime(now, clientTime, clientTimeZone)
	runtimeLines := []string{
		"Runtime context:",
		fmt.Sprintf("- Current time: %s.", currentTime),
	}
	if idleGap := previousMessageIdleGap(history); idleGap >= 24*time.Hour {
		runtimeLines = append(
			runtimeLines,
			fmt.Sprintf(
				"- The previous message in this chat was %s ago. If relevant, gently account for the time gap without overemphasizing it.",
				formatApproximateDuration(idleGap),
			),
		)
	}

	runtimeContext := strings.Join(runtimeLines, "\n")
	if normalizedSystemPrompt := strings.TrimSpace(systemPrompt); normalizedSystemPrompt != "" {
		return normalizedSystemPrompt + "\n\n" + runtimeContext
	}
	return runtimeContext
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
			if text := strings.TrimSpace(item.Text); text != "" {
				parts = append(parts, ProviderMessagePart{
					Type:        "text",
					Text:        text,
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

func previousMessageIdleGap(messages []map[string]any) time.Duration {
	if len(messages) < 2 {
		return 0
	}
	currentTimestamp := int64Value(messages[len(messages)-1]["timestamp"])
	previousTimestamp := int64Value(messages[len(messages)-2]["timestamp"])
	if currentTimestamp <= 0 || previousTimestamp <= 0 || currentTimestamp <= previousTimestamp {
		return 0
	}
	return time.Duration(currentTimestamp-previousTimestamp) * time.Millisecond
}

func formatApproximateDuration(duration time.Duration) string {
	days := int(duration.Hours() / 24)
	if days >= 2 {
		return fmt.Sprintf("about %d days", days)
	}
	if days == 1 {
		return "about 1 day"
	}
	hours := int(duration.Hours())
	if hours >= 2 {
		return fmt.Sprintf("about %d hours", hours)
	}
	return "about 1 hour"
}
