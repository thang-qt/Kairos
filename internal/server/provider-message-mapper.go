package server

import (
	"encoding/json"
	"fmt"
	"strings"
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

	if len(content) == 0 {
		return nil, "", fmt.Errorf("message must contain text or a valid attachment")
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
	segments ...ProviderTextSegment,
) []chatMessageContentPart {
	content := make([]chatMessageContentPart, 0, 2+len(toolCalls))
	if normalizedThinking := strings.TrimSpace(thinking); normalizedThinking != "" {
		content = append(content, newThinkingContentPart(normalizedThinking))
	}
	if len(segments) == 0 && strings.TrimSpace(text) != "" {
		segments = []ProviderTextSegment{{Text: text}}
	}
	for _, segment := range segments {
		if segment.Text == "" {
			continue
		}
		part := newTextContentPart(segment.Text)
		part.Phase = segment.Phase
		part.PhaseSource = segment.PhaseSource
		content = append(content, part)
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

func toolStartedSnapshot(message map[string]any, callID string) map[string]any {
	copy := map[string]any{}
	for key, value := range message {
		copy[key] = value
	}
	parts := contentPartsFromAny(message["content"])
	for index := range parts {
		if parts[index].Type == "toolCall" && parts[index].ID == callID {
			parts[index].Status = "running"
		}
	}
	copy["content"] = contentPartsToMaps(parts)
	return copy
}
