package server

import "strings"

type chatMessage struct {
	ID               string
	Role             string
	Model            string
	ModelName        string
	ModelDescription string
	ClientID         string
	RunID            string
	RoundIndex       *int
	MessageIndex     *int
	Timestamp        int64
	Content          []chatMessageContentPart
	Details          map[string]any
	ToolCallID       string
	ToolName         string
	IsError          bool
}

type chatMessageContentPart struct {
	Type     string
	Text     string
	Thinking string
	Source   *chatMessageContentSource
	ID       string
	Name     string
	Args     map[string]any
	ArgsJSON string
	Status   string
	Emoji    string
}

type chatMessageContentSource struct {
	Type      string
	MediaType string
	Data      string
}

func newTextContentPart(text string) chatMessageContentPart {
	return chatMessageContentPart{
		Type: "text",
		Text: strings.TrimSpace(text),
	}
}

func newThinkingContentPart(thinking string) chatMessageContentPart {
	return chatMessageContentPart{
		Type:     "thinking",
		Thinking: strings.TrimSpace(thinking),
	}
}

func newImageContentPart(mimeType string, data string) chatMessageContentPart {
	return chatMessageContentPart{
		Type: "image",
		Source: &chatMessageContentSource{
			Type:      "base64",
			MediaType: strings.TrimSpace(mimeType),
			Data:      strings.TrimSpace(data),
		},
	}
}

func newToolCallContentPart(toolCall ProviderToolCall) chatMessageContentPart {
	return chatMessageContentPart{
		Type:     "toolCall",
		ID:       strings.TrimSpace(toolCall.ID),
		Name:     strings.TrimSpace(toolCall.Name),
		Args:     toolCall.Args,
		ArgsJSON: strings.TrimSpace(toolCall.ArgsJSON),
	}
}

func newToolProgressContentPart(progress ProviderToolProgress) chatMessageContentPart {
	arguments := map[string]any{}
	if label := strings.TrimSpace(progress.Label); label != "" {
		arguments["label"] = label
	}
	return chatMessageContentPart{
		Type:   "toolCall",
		ID:     strings.TrimSpace(progress.ID),
		Name:   strings.TrimSpace(progress.Name),
		Args:   arguments,
		Status: strings.TrimSpace(progress.Status),
		Emoji:  strings.TrimSpace(progress.Emoji),
	}
}

func (message chatMessage) toMap() map[string]any {
	value := map[string]any{
		"id":      message.ID,
		"role":    message.Role,
		"content": contentPartsToMaps(message.Content),
	}
	if message.Model != "" {
		value["model"] = message.Model
	}
	if message.ModelName != "" {
		value["modelName"] = message.ModelName
	}
	if message.ModelDescription != "" {
		value["modelDescription"] = message.ModelDescription
	}
	if message.ClientID != "" {
		value["clientId"] = message.ClientID
	}
	if message.RunID != "" {
		value["runId"] = message.RunID
	}
	if message.RoundIndex != nil {
		value["roundIndex"] = *message.RoundIndex
	}
	if message.MessageIndex != nil {
		value["messageIndex"] = *message.MessageIndex
	}
	if message.Timestamp > 0 {
		value["timestamp"] = message.Timestamp
	}
	if len(message.Details) > 0 {
		value["details"] = message.Details
	}
	if message.ToolCallID != "" {
		value["toolCallId"] = message.ToolCallID
	}
	if message.ToolName != "" {
		value["toolName"] = message.ToolName
	}
	if message.IsError {
		value["isError"] = true
	}
	return value
}

func contentPartsToMaps(parts []chatMessageContentPart) []map[string]any {
	values := make([]map[string]any, 0, len(parts))
	for _, part := range parts {
		switch strings.TrimSpace(part.Type) {
		case "text":
			text := strings.TrimSpace(part.Text)
			if text == "" {
				continue
			}
			values = append(values, map[string]any{
				"type": "text",
				"text": text,
			})
		case "thinking":
			thinking := strings.TrimSpace(part.Thinking)
			if thinking == "" {
				continue
			}
			values = append(values, map[string]any{
				"type":     "thinking",
				"thinking": thinking,
			})
		case "image":
			if part.Source == nil {
				continue
			}
			mimeType := strings.TrimSpace(part.Source.MediaType)
			data := strings.TrimSpace(part.Source.Data)
			if strings.TrimSpace(part.Source.Type) != "base64" || mimeType == "" || data == "" {
				continue
			}
			values = append(values, map[string]any{
				"type": "image",
				"source": map[string]any{
					"type":       "base64",
					"media_type": mimeType,
					"data":       data,
				},
			})
		case "toolCall":
			toolCall := map[string]any{
				"type": "toolCall",
			}
			if id := strings.TrimSpace(part.ID); id != "" {
				toolCall["id"] = id
			}
			if name := strings.TrimSpace(part.Name); name != "" {
				toolCall["name"] = name
			}
			if len(part.Args) > 0 {
				toolCall["arguments"] = part.Args
			}
			if argsJSON := strings.TrimSpace(part.ArgsJSON); argsJSON != "" {
				toolCall["partialJson"] = argsJSON
			}
			if status := strings.TrimSpace(part.Status); status != "" {
				toolCall["status"] = status
			}
			if emoji := strings.TrimSpace(part.Emoji); emoji != "" {
				toolCall["emoji"] = emoji
			}
			values = append(values, toolCall)
		}
	}
	return values
}

func contentPartsFromAny(value any) []chatMessageContentPart {
	switch typed := value.(type) {
	case []map[string]any:
		return contentPartsFromMaps(typed)
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			part, ok := item.(map[string]any)
			if !ok {
				continue
			}
			items = append(items, part)
		}
		return contentPartsFromMaps(items)
	default:
		return nil
	}
}

func contentPartsFromMaps(items []map[string]any) []chatMessageContentPart {
	parts := make([]chatMessageContentPart, 0, len(items))
	for _, item := range items {
		switch strings.TrimSpace(stringValueFromMap(item, "type")) {
		case "text":
			text := strings.TrimSpace(stringValueFromMap(item, "text"))
			if text != "" {
				parts = append(parts, newTextContentPart(text))
			}
		case "thinking":
			thinking := strings.TrimSpace(stringValueFromMap(item, "thinking"))
			if thinking != "" {
				parts = append(parts, newThinkingContentPart(thinking))
			}
		case "image":
			source, ok := item["source"].(map[string]any)
			if !ok || strings.TrimSpace(stringValueFromMap(source, "type")) != "base64" {
				continue
			}
			mimeType := strings.TrimSpace(stringValueFromMap(source, "media_type"))
			data := strings.TrimSpace(stringValueFromMap(source, "data"))
			if mimeType != "" && data != "" {
				parts = append(parts, newImageContentPart(mimeType, data))
			}
		case "toolCall":
			toolCall := chatMessageContentPart{
				Type:     "toolCall",
				ID:       strings.TrimSpace(stringValueFromMap(item, "id")),
				Name:     strings.TrimSpace(stringValueFromMap(item, "name")),
				ArgsJSON: strings.TrimSpace(stringValueFromMap(item, "partialJson")),
				Status:   strings.TrimSpace(stringValueFromMap(item, "status")),
				Emoji:    strings.TrimSpace(stringValueFromMap(item, "emoji")),
			}
			if args, ok := item["arguments"].(map[string]any); ok {
				toolCall.Args = args
			}
			parts = append(parts, toolCall)
		}
	}
	return parts
}

func textFromContentParts(parts []chatMessageContentPart) string {
	textParts := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part.Type) != "text" {
			continue
		}
		text := strings.TrimSpace(part.Text)
		if text != "" {
			textParts = append(textParts, text)
		}
	}
	return strings.Join(textParts, " ")
}
