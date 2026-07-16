package server

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func buildUserMessage(
	message string,
	attachments []AttachmentPayload,
	clientID string,
) (map[string]any, string, error) {
	normalizedMessage := strings.TrimSpace(message)
	if normalizedMessage == "" && len(attachments) == 0 {
		return nil, "", fmt.Errorf("message must not be empty")
	}

	content := make([]chatMessageContentPart, 0, len(attachments)+1)
	for _, attachment := range attachments {
		if strings.TrimSpace(attachment.MimeType) == "" || strings.TrimSpace(attachment.Content) == "" {
			continue
		}
		content = append(content, newImageContentPart(attachment.MimeType, attachment.Content))
	}
	if normalizedMessage != "" {
		content = append(content, newTextContentPart(normalizedMessage))
	}

	userMessage := chatMessage{
		ID:      newID(),
		Role:    "user",
		Content: content,
	}
	if normalizedClientID := strings.TrimSpace(clientID); normalizedClientID != "" {
		userMessage.ClientID = normalizedClientID
	}

	return userMessage.toMap(), normalizedMessage, nil
}

func normalizeModel(value string) string {
	return strings.TrimSpace(value)
}

func buildAssistantContent(
	thinking string,
	text string,
	toolCalls []ProviderToolCall,
) []chatMessageContentPart {
	content := make([]chatMessageContentPart, 0, 2+len(toolCalls))
	if normalizedThinking := strings.TrimSpace(thinking); normalizedThinking != "" {
		content = append(content, newThinkingContentPart(normalizedThinking))
	}
	if normalizedText := strings.TrimSpace(text); normalizedText != "" {
		content = append(content, newTextContentPart(normalizedText))
	}
	for _, toolCall := range toolCalls {
		if strings.TrimSpace(toolCall.ID) == "" &&
			strings.TrimSpace(toolCall.Name) == "" &&
			strings.TrimSpace(toolCall.ArgsJSON) == "" &&
			len(toolCall.Args) == 0 {
			continue
		}
		content = append(content, newToolCallContentPart(toolCall))
	}
	return content
}

func buildAssistantMessage(
	messageID string,
	displayModel assistantModelDisplay,
	timestamp int64,
	content []chatMessageContentPart,
) map[string]any {
	return buildAssistantMessageWithLineage(messageID, displayModel, timestamp, content, "", -1)
}

func buildAssistantMessageWithLineage(
	messageID string,
	displayModel assistantModelDisplay,
	timestamp int64,
	content []chatMessageContentPart,
	runID string,
	roundIndex int,
) map[string]any {
	message := chatMessage{
		ID:               messageID,
		Role:             "assistant",
		Model:            displayModel.ID,
		ModelName:        displayModel.Name,
		ModelDescription: displayModel.Description,
		RunID:            strings.TrimSpace(runID),
		Timestamp:        timestamp,
		Content:          content,
	}
	if roundIndex >= 0 {
		message.RoundIndex = intPointer(roundIndex)
		message.MessageIndex = intPointer(0)
	}
	return message.toMap()
}

type assistantModelDisplay struct {
	ID          string
	Name        string
	Description string
}

func (display assistantModelDisplay) withProviderResult(
	result ChatGenerationResult,
) assistantModelDisplay {
	nextID := firstNonEmpty(result.Model, display.ID)
	nextName := preferDisplayModelName(result.ModelName, display.Name, nextID)
	nextDescription := firstNonEmpty(result.ModelDescription, display.Description)
	return assistantModelDisplay{
		ID:          nextID,
		Name:        nextName,
		Description: nextDescription,
	}
}

func preferDisplayModelName(
	candidate string,
	current string,
	modelID string,
) string {
	normalizedCandidate := strings.TrimSpace(candidate)
	normalizedCurrent := strings.TrimSpace(current)
	normalizedModelID := strings.TrimSpace(modelID)

	if normalizedCandidate == "" {
		return normalizedCurrent
	}
	if normalizedCurrent == "" {
		return normalizedCandidate
	}
	if normalizedModelID == "" {
		return normalizedCandidate
	}
	if normalizedCandidate == normalizedModelID &&
		normalizedCurrent != normalizedModelID {
		return normalizedCurrent
	}
	return normalizedCandidate
}

func buildUsageDetails(result ChatGenerationResult) map[string]any {
	if result.PromptTokens <= 0 && result.CompletionTokens <= 0 && result.TotalTokens <= 0 {
		return nil
	}

	return map[string]any{
		"promptTokens":     result.PromptTokens,
		"completionTokens": result.CompletionTokens,
		"totalTokens":      result.TotalTokens,
	}
}

func buildGenerationDetails(result ChatGenerationResult) map[string]any {
	details := make(map[string]any)
	for key, value := range result.Details {
		if value != nil {
			details[key] = value
		}
	}
	if usageDetails := buildUsageDetails(result); usageDetails != nil {
		details["usage"] = usageDetails
	}
	if len(result.ToolCalls) > 0 {
		details["toolCalls"] = providerToolCallsDetails(result.ToolCalls)
	}
	if len(details) == 0 {
		return nil
	}
	return details
}

func mergeProviderToolCalls(
	current []ProviderToolCall,
	next []ProviderToolCall,
) []ProviderToolCall {
	if len(next) == 0 {
		return current
	}
	merged := append([]ProviderToolCall(nil), current...)
	for _, toolCall := range next {
		index := -1
		for candidateIndex, candidate := range merged {
			if strings.TrimSpace(toolCall.ID) != "" &&
				strings.TrimSpace(candidate.ID) == strings.TrimSpace(toolCall.ID) {
				index = candidateIndex
				break
			}
		}
		if index < 0 {
			merged = append(merged, toolCall)
			continue
		}
		if strings.TrimSpace(toolCall.Name) != "" {
			merged[index].Name = strings.TrimSpace(toolCall.Name)
		}
		if strings.TrimSpace(toolCall.ArgsJSON) != "" {
			merged[index].ArgsJSON = strings.TrimSpace(toolCall.ArgsJSON)
		}
		if len(toolCall.Args) > 0 {
			merged[index].Args = toolCall.Args
		}
	}
	return merged
}

func buildProviderWebSearchOptions(
	enabled bool,
) *ProviderWebSearchOptions {
	if !enabled {
		return nil
	}
	return &ProviderWebSearchOptions{}
}

func buildRunEvent(
	record runRecord,
	session sessionRecord,
	state string,
	errorMessage string,
	message map[string]any,
) ChatEvent {
	return buildRunEventWithSession(record, session, state, errorMessage, message, nil)
}

func buildRunEventWithSession(
	record runRecord,
	session sessionRecord,
	state string,
	errorMessage string,
	message map[string]any,
	summary *SessionSummary,
) ChatEvent {
	if message != nil && strings.TrimSpace(stringValueFromMap(message, "runId")) == "" {
		message = cloneMap(message)
		message["runId"] = record.ID
	}
	return ChatEvent{
		RunID:      record.ID,
		SessionKey: session.ID,
		FriendlyID: session.FriendlyID,
		State:      state,
		Error:      errorMessage,
		Message:    message,
		Session:    summary,
	}
}

func cloneMap(value map[string]any) map[string]any {
	cloned := make(map[string]any, len(value))
	for key, item := range value {
		cloned[key] = item
	}
	return cloned
}

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
					Type: "text",
					Text: text,
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

func latestMessageTimestamp(messages []map[string]any) int64 {
	var latest int64
	for _, message := range messages {
		timestamp := int64Value(message["timestamp"])
		if timestamp > latest {
			latest = timestamp
		}
	}
	return latest
}

func intPointer(value int) *int {
	return &value
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func int64Value(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return parsed
		}
	}
	return 0
}
