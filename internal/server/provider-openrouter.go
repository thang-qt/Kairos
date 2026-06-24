package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"

	openrouter "github.com/revrost/go-openrouter"
)

const openRouterProviderKind = "openrouter"
const defaultProviderKind = openRouterProviderKind
const defaultOpenRouterBaseURL = "https://openrouter.ai/api/v1"

type OpenRouterDriver struct {
	httpClient *http.Client
}

func defaultProviderDrivers() map[string]ProviderDriver {
	// Chat completion streams can legitimately stay open for longer than a
	// fixed client timeout. Cancellation is controlled by the request context so
	// long-running streams are not interrupted while reading the response body.
	httpClient := &http.Client{}
	return map[string]ProviderDriver{
		openRouterProviderKind: &OpenRouterDriver{httpClient: httpClient},
		openAIProviderKind:     &OpenAICompatibleDriver{httpClient: httpClient},
	}
}

func (driver *OpenRouterDriver) Kind() string {
	return openRouterProviderKind
}

func (driver *OpenRouterDriver) ListModels(
	ctx context.Context,
	provider resolvedProvider,
) ([]ProviderModel, error) {
	if strings.TrimSpace(provider.APIKey) == "" {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}

	models, err := driver.client(provider).ListModels(ctx)
	if err != nil {
		if len(provider.StaticModels) > 0 {
			return modelsFromStaticList(provider.StaticModels, provider.Record), nil
		}
		return nil, fmt.Errorf("list OpenRouter models: %w", err)
	}

	result := make([]ProviderModel, 0, len(models))
	for _, model := range models {
		if strings.TrimSpace(model.ID) == "" {
			continue
		}
		result = append(result, ProviderModel{
			ID:            strings.TrimSpace(model.ID),
			Object:        "model",
			Created:       model.Created,
			OwnedBy:       provider.Record.Label,
			Name:          strings.TrimSpace(model.Name),
			Description:   strings.TrimSpace(model.Description),
			ContextWindow: openRouterModelContextWindow(model),
			ProviderRef:   provider.Record.Ref,
			ProviderLabel: provider.Record.Label,
		})
	}
	if len(result) == 0 {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}
	slices.SortFunc(result, func(left ProviderModel, right ProviderModel) int {
		return strings.Compare(left.ID, right.ID)
	})
	return result, nil
}

func (driver *OpenRouterDriver) GenerateChatStream(
	ctx context.Context,
	provider resolvedProvider,
	request ChatGenerationRequest,
	onDelta func(delta ChatGenerationDelta) error,
) (ChatGenerationResult, error) {
	stream, err := driver.client(provider).CreateChatCompletionStream(
		ctx,
		buildOpenRouterChatRequest(request),
	)
	if err != nil {
		return ChatGenerationResult{}, fmt.Errorf("stream OpenRouter chat completion: %w", err)
	}
	defer stream.Close()

	accumulator := openRouterStreamAccumulator{}
	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return ChatGenerationResult{}, fmt.Errorf("receive OpenRouter chat completion: %w", err)
		}
		delta := accumulator.addChunk(chunk)
		if delta.Text == "" && delta.Thinking == "" && len(delta.ToolCalls) == 0 {
			continue
		}
		if err := onDelta(delta); err != nil {
			return ChatGenerationResult{}, err
		}
	}

	return accumulator.result(provider.Record.Label, request.Model), nil
}

func (driver *OpenRouterDriver) client(provider resolvedProvider) *openrouter.Client {
	config := openrouter.DefaultConfig(strings.TrimSpace(provider.APIKey))
	config.HTTPClient = driver.httpClient
	config.BaseURL = normalizeOpenRouterBaseURL(provider.BaseURL)
	config.XTitle = "Kairos"
	return openrouter.NewClientWithConfig(*config)
}

func buildOpenRouterChatRequest(request ChatGenerationRequest) openrouter.ChatCompletionRequest {
	chatRequest := openrouter.ChatCompletionRequest{
		Model:    strings.TrimSpace(request.Model),
		Messages: buildOpenRouterMessages(request.Messages),
		Stream:   true,
		StreamOptions: &openrouter.StreamOptions{
			IncludeUsage: true,
		},
		Usage: &openrouter.IncludeUsage{
			Include: true,
		},
	}
	if len(request.Tools) > 0 {
		chatRequest.Tools = buildOpenRouterTools(request.Tools)
	}
	if request.ToolChoice != nil {
		chatRequest.ToolChoice = request.ToolChoice
	}
	applyOpenRouterAdvancedOptions(&chatRequest, request.Advanced)
	if len(request.Plugins) > 0 {
		chatRequest.Plugins = append(chatRequest.Plugins, buildOpenRouterPlugins(request.Plugins)...)
	}
	return chatRequest
}

func applyOpenRouterAdvancedOptions(chatRequest *openrouter.ChatCompletionRequest, advanced *ChatAdvancedOptions) {
	if advanced == nil {
		return
	}
	if advanced.Reasoning != nil {
		effort := normalizeReasoningEffort(advanced.Reasoning.Effort)
		chatRequest.Reasoning = &openrouter.ChatCompletionReasoning{
			Effort: &effort,
		}
	}
	if advanced.Sampling != nil {
		if advanced.Sampling.Temperature != nil {
			chatRequest.Temperature = clampFloat32(*advanced.Sampling.Temperature, 0, 2)
		}
		if advanced.Sampling.TopP != nil {
			chatRequest.TopP = clampFloat32(*advanced.Sampling.TopP, 0, 1)
		}
		if advanced.Sampling.TopK != nil && *advanced.Sampling.TopK > 0 {
			chatRequest.TopK = clampInt(*advanced.Sampling.TopK, 0, 1000)
		}
	}
	if advanced.Penalties != nil {
		if advanced.Penalties.FrequencyPenalty != nil {
			chatRequest.FrequencyPenalty = clampFloat32(*advanced.Penalties.FrequencyPenalty, -2, 2)
		}
		if advanced.Penalties.PresencePenalty != nil {
			chatRequest.PresencePenalty = clampFloat32(*advanced.Penalties.PresencePenalty, -2, 2)
		}
	}
	if advanced.MaxTokens != nil && *advanced.MaxTokens > 0 {
		chatRequest.MaxTokens = clampInt(*advanced.MaxTokens, 1, 200000)
	}
}

func normalizeReasoningEffort(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "low", "medium", "high":
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

func buildOpenRouterMessages(messages []ProviderMessage) []openrouter.ChatCompletionMessage {
	result := make([]openrouter.ChatCompletionMessage, 0, len(messages))
	for _, message := range messages {
		role := strings.TrimSpace(message.Role)
		switch role {
		case "assistant":
			result = append(result, buildOpenRouterAssistantMessage(message))
		case "system":
			result = append(result, openrouter.ChatCompletionMessage{
				Role:    openrouter.ChatMessageRoleSystem,
				Content: openrouter.Content{Text: collectProviderMessageText(message.Parts)},
			})
		case "tool":
			result = append(result, openrouter.ChatCompletionMessage{
				Role:       openrouter.ChatMessageRoleTool,
				Content:    openrouter.Content{Text: collectProviderMessageText(message.Parts)},
				ToolCallID: strings.TrimSpace(message.ToolCallID),
			})
		case "user":
			fallthrough
		default:
			result = append(result, openrouter.ChatCompletionMessage{
				Role:    openrouter.ChatMessageRoleUser,
				Content: buildOpenRouterContent(message.Parts),
			})
		}
	}
	return result
}

func buildOpenRouterAssistantMessage(message ProviderMessage) openrouter.ChatCompletionMessage {
	toolCalls := make([]openrouter.ToolCall, 0)
	for _, part := range message.Parts {
		if strings.TrimSpace(part.Type) != "toolCall" {
			continue
		}
		toolCalls = append(toolCalls, openrouter.ToolCall{
			ID:   strings.TrimSpace(part.ID),
			Type: openrouter.ToolTypeFunction,
			Function: openrouter.FunctionCall{
				Name:      strings.TrimSpace(part.Name),
				Arguments: providerToolCallArguments(part),
			},
		})
	}
	return openrouter.ChatCompletionMessage{
		Role:      openrouter.ChatMessageRoleAssistant,
		Content:   openrouter.Content{Text: collectProviderMessageText(message.Parts)},
		ToolCalls: toolCalls,
	}
}

func buildOpenRouterContent(parts []ProviderMessagePart) openrouter.Content {
	messageParts := make([]openrouter.ChatMessagePart, 0, len(parts))
	for _, part := range parts {
		switch strings.TrimSpace(part.Type) {
		case "image":
			mimeType := strings.TrimSpace(part.MimeType)
			content := strings.TrimSpace(part.Content)
			if mimeType == "" || content == "" {
				continue
			}
			messageParts = append(messageParts, openrouter.ChatMessagePart{
				Type: openrouter.ChatMessagePartTypeImageURL,
				ImageURL: &openrouter.ChatMessageImageURL{
					URL: "data:" + mimeType + ";base64," + content,
				},
			})
		case "text":
			text := strings.TrimSpace(part.Text)
			if text != "" {
				messageParts = append(messageParts, openrouter.ChatMessagePart{
					Type: openrouter.ChatMessagePartTypeText,
					Text: text,
				})
			}
		}
	}
	if len(messageParts) > 0 {
		return openrouter.Content{Multi: messageParts}
	}
	return openrouter.Content{Text: collectProviderMessageText(parts)}
}

func buildOpenRouterTools(tools []ProviderTool) []openrouter.Tool {
	result := make([]openrouter.Tool, 0, len(tools))
	for _, tool := range tools {
		if strings.TrimSpace(tool.Name) == "" {
			continue
		}
		result = append(result, openrouter.Tool{
			Type: openrouter.ToolTypeFunction,
			Function: &openrouter.FunctionDefinition{
				Name:        strings.TrimSpace(tool.Name),
				Description: strings.TrimSpace(tool.Description),
				Strict:      tool.Strict,
				Parameters:  tool.Parameters,
			},
		})
	}
	return result
}

func buildOpenRouterPlugins(plugins []ProviderPlugin) []openrouter.ChatCompletionPlugin {
	result := make([]openrouter.ChatCompletionPlugin, 0, len(plugins))
	for _, plugin := range plugins {
		id := strings.TrimSpace(plugin.ID)
		if id == "" {
			continue
		}
		next := openrouter.ChatCompletionPlugin{
			ID:         openrouter.PluginID(id),
			MaxResults: plugin.MaxResults,
		}
		if engine := strings.TrimSpace(plugin.PDFEngine); engine != "" {
			next.PDF = &openrouter.PDFPlugin{Engine: engine}
		}
		result = append(result, next)
	}
	return result
}

func normalizeOpenRouterBaseURL(value string) string {
	normalized := strings.TrimRight(strings.TrimSpace(value), "/")
	if normalized == "" {
		return defaultOpenRouterBaseURL
	}
	return normalized
}

func openRouterModelContextWindow(model openrouter.Model) int64 {
	if model.ContextLength != nil && *model.ContextLength > 0 {
		return *model.ContextLength
	}
	if model.TopProvider.ContextLength != nil && *model.TopProvider.ContextLength > 0 {
		return *model.TopProvider.ContextLength
	}
	return 0
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

type openRouterStreamAccumulator struct {
	model            string
	provider         string
	text             strings.Builder
	thinking         strings.Builder
	promptTokens     int64
	completionTokens int64
	totalTokens      int64
	toolCalls        []ProviderToolCall
	toolCallByIndex  map[int]int
	citations        []string
	annotations      []map[string]any
	images           []map[string]any
	audio            map[string]any
	reasoningDetails []map[string]any
}

func (accumulator *openRouterStreamAccumulator) addChunk(
	chunk openrouter.ChatCompletionStreamResponse,
) ChatGenerationDelta {
	if strings.TrimSpace(chunk.Model) != "" {
		accumulator.model = strings.TrimSpace(chunk.Model)
	}
	if strings.TrimSpace(chunk.Provider) != "" {
		accumulator.provider = strings.TrimSpace(chunk.Provider)
	}
	if chunk.Usage != nil {
		accumulator.promptTokens = int64(chunk.Usage.PromptTokens)
		accumulator.completionTokens = int64(chunk.Usage.CompletionTokens)
		accumulator.totalTokens = int64(chunk.Usage.TotalTokens)
	}

	var delta ChatGenerationDelta
	for _, choice := range chunk.Choices {
		if choice.Delta.Content != "" {
			accumulator.text.WriteString(choice.Delta.Content)
			delta.Text += choice.Delta.Content
		}
		if thinking := openRouterThinkingDelta(choice.Delta); thinking != "" {
			accumulator.thinking.WriteString(thinking)
			delta.Thinking += thinking
		}
		if len(choice.Delta.ToolCalls) > 0 {
			toolCalls := accumulator.mergeToolCalls(choice.Delta.ToolCalls)
			delta.ToolCalls = append(delta.ToolCalls, toolCalls...)
		}
		if len(choice.Delta.Annotations) > 0 {
			accumulator.annotations = append(
				accumulator.annotations,
				openRouterAnnotationsDetails(choice.Delta.Annotations)...,
			)
		}
		if len(choice.Delta.Images) > 0 {
			accumulator.images = append(accumulator.images, openRouterImagesDetails(choice.Delta.Images)...)
		}
		if choice.Delta.Audio != nil {
			accumulator.audio = openRouterAudioDetails(*choice.Delta.Audio)
		}
		if len(choice.Delta.ReasoningDetails) > 0 {
			accumulator.reasoningDetails = append(
				accumulator.reasoningDetails,
				openRouterReasoningDetails(choice.Delta.ReasoningDetails)...,
			)
		}
	}
	return delta
}

func (accumulator *openRouterStreamAccumulator) mergeToolCalls(
	toolCalls []openrouter.ToolCall,
) []ProviderToolCall {
	if accumulator.toolCallByIndex == nil {
		accumulator.toolCallByIndex = make(map[int]int)
	}
	changed := make([]ProviderToolCall, 0, len(toolCalls))
	for _, toolCall := range toolCalls {
		index := len(accumulator.toolCalls)
		if toolCall.Index != nil {
			if existing, ok := accumulator.toolCallByIndex[*toolCall.Index]; ok {
				index = existing
			} else {
				accumulator.toolCallByIndex[*toolCall.Index] = index
			}
		}
		if index == len(accumulator.toolCalls) {
			accumulator.toolCalls = append(accumulator.toolCalls, ProviderToolCall{})
		}
		current := accumulator.toolCalls[index]
		if strings.TrimSpace(toolCall.ID) != "" {
			current.ID = strings.TrimSpace(toolCall.ID)
		}
		if strings.TrimSpace(toolCall.Function.Name) != "" {
			current.Name = strings.TrimSpace(toolCall.Function.Name)
		}
		if toolCall.Function.Arguments != "" {
			current.ArgsJSON += toolCall.Function.Arguments
			current.Args = parseToolCallArguments(current.ArgsJSON)
		}
		accumulator.toolCalls[index] = current
		changed = append(changed, current)
	}
	return changed
}

func (accumulator openRouterStreamAccumulator) result(
	providerLabel string,
	requestModel string,
) ChatGenerationResult {
	details := map[string]any{}
	if accumulator.provider != "" {
		details["provider"] = accumulator.provider
	}
	if len(accumulator.toolCalls) > 0 {
		details["toolCalls"] = providerToolCallsDetails(accumulator.toolCalls)
	}
	if len(accumulator.citations) > 0 {
		details["citations"] = accumulator.citations
	}
	if len(accumulator.annotations) > 0 {
		details["annotations"] = accumulator.annotations
	}
	if len(accumulator.images) > 0 {
		details["images"] = accumulator.images
	}
	if len(accumulator.audio) > 0 {
		details["audio"] = accumulator.audio
	}
	if len(accumulator.reasoningDetails) > 0 {
		details["reasoningDetails"] = accumulator.reasoningDetails
	}

	model := firstNonEmpty(accumulator.model, requestModel)
	return ChatGenerationResult{
		Model:            model,
		ModelName:        model,
		ModelDescription: providerLabel,
		OutputText:       strings.TrimSpace(accumulator.text.String()),
		ThinkingText:     strings.TrimSpace(accumulator.thinking.String()),
		PromptTokens:     accumulator.promptTokens,
		CompletionTokens: accumulator.completionTokens,
		TotalTokens:      accumulator.totalTokens,
		ToolCalls:        accumulator.toolCalls,
		Details:          details,
	}
}

func openRouterThinkingDelta(delta openrouter.ChatCompletionStreamChoiceDelta) string {
	if delta.Reasoning != nil && *delta.Reasoning != "" {
		return *delta.Reasoning
	}
	if delta.ReasoningContent != "" {
		return delta.ReasoningContent
	}
	return ""
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

func openRouterAnnotationsDetails(annotations []openrouter.Annotation) []map[string]any {
	result := make([]map[string]any, 0, len(annotations))
	for _, annotation := range annotations {
		result = append(result, map[string]any{
			"type": annotation.Type,
			"urlCitation": map[string]any{
				"startIndex": annotation.URLCitation.StartIndex,
				"endIndex":   annotation.URLCitation.EndIndex,
				"title":      annotation.URLCitation.Title,
				"content":    annotation.URLCitation.Content,
				"url":        annotation.URLCitation.URL,
			},
		})
	}
	return result
}

func openRouterImagesDetails(images []openrouter.ChatCompletionImage) []map[string]any {
	result := make([]map[string]any, 0, len(images))
	for _, image := range images {
		result = append(result, map[string]any{
			"index": image.Index,
			"type":  image.Type,
			"url":   image.ImageURL.URL,
		})
	}
	return result
}

func openRouterAudioDetails(audio openrouter.ChatCompletionAudio) map[string]any {
	result := map[string]any{}
	if audio.Data != "" {
		result["data"] = audio.Data
	}
	if audio.Transcript != "" {
		result["transcript"] = audio.Transcript
	}
	return result
}

func openRouterReasoningDetails(
	details []openrouter.ChatCompletionReasoningDetails,
) []map[string]any {
	result := make([]map[string]any, 0, len(details))
	for _, detail := range details {
		result = append(result, map[string]any{
			"id":      detail.ID,
			"index":   detail.Index,
			"type":    detail.Type,
			"text":    detail.Text,
			"summary": detail.Summary,
			"data":    detail.Data,
			"format":  detail.Format,
		})
	}
	return result
}
