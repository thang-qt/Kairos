package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"
)

const openAIProviderKind = "openai"
const defaultOpenAIBaseURL = "https://api.openai.com/v1"

type OpenAICompatibleDriver struct {
	httpClient *http.Client
}

func (driver *OpenAICompatibleDriver) Kind() string { return openAIProviderKind }

func (driver *OpenAICompatibleDriver) ListModels(ctx context.Context, provider resolvedProvider) ([]ProviderModel, error) {
	if strings.TrimSpace(provider.APIKey) == "" {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, normalizeOpenAIBaseURL(provider.BaseURL)+"/models", nil)
	if err != nil {
		return nil, err
	}
	setOpenAIHeaders(request, provider.APIKey, "")
	response, err := driver.httpClient.Do(request)
	if err != nil {
		if len(provider.StaticModels) > 0 {
			return modelsFromStaticList(provider.StaticModels, provider.Record), nil
		}
		return nil, fmt.Errorf("list OpenAI-compatible models: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusBadRequest {
		if len(provider.StaticModels) > 0 {
			return modelsFromStaticList(provider.StaticModels, provider.Record), nil
		}
		return nil, fmt.Errorf("list OpenAI-compatible models: %s: %s", response.Status, readLimitedBody(response.Body))
	}
	var payload openAIModelsResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		if len(provider.StaticModels) > 0 {
			return modelsFromStaticList(provider.StaticModels, provider.Record), nil
		}
		return nil, fmt.Errorf("decode OpenAI-compatible models: %w", err)
	}
	result := make([]ProviderModel, 0, len(payload.Data))
	for _, model := range payload.Data {
		if strings.TrimSpace(model.ID) == "" {
			continue
		}
		result = append(result, ProviderModel{
			ID:            strings.TrimSpace(model.ID),
			Object:        firstNonEmpty(model.Object, "model"),
			Created:       model.Created,
			OwnedBy:       firstNonEmpty(model.OwnedBy, provider.Record.Label),
			Name:          strings.TrimSpace(model.ID),
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

func (driver *OpenAICompatibleDriver) GenerateChatStream(
	ctx context.Context,
	provider resolvedProvider,
	request ChatGenerationRequest,
	onDelta func(delta ChatGenerationDelta) error,
) (ChatGenerationResult, error) {
	body, err := json.Marshal(buildOpenAIChatRequest(request))
	if err != nil {
		return ChatGenerationResult{}, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, normalizeOpenAIBaseURL(provider.BaseURL)+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return ChatGenerationResult{}, err
	}
	setOpenAIHeaders(httpRequest, provider.APIKey, "text/event-stream")
	response, err := driver.httpClient.Do(httpRequest)
	if err != nil {
		return ChatGenerationResult{}, fmt.Errorf("stream OpenAI-compatible chat completion: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusBadRequest {
		return ChatGenerationResult{}, fmt.Errorf("stream OpenAI-compatible chat completion: %s: %s", response.Status, readLimitedBody(response.Body))
	}

	accumulator := openAIStreamAccumulator{}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var chunk openAIChatCompletionChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return ChatGenerationResult{}, fmt.Errorf("decode OpenAI-compatible stream chunk: %w", err)
		}
		delta := accumulator.addChunk(chunk)
		if delta.Text == "" && len(delta.ToolCalls) == 0 {
			continue
		}
		if err := onDelta(delta); err != nil {
			return ChatGenerationResult{}, err
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, context.Canceled) {
		return ChatGenerationResult{}, fmt.Errorf("read OpenAI-compatible stream: %w", err)
	}
	return accumulator.result(provider.Record.Label, request.Model), nil
}

func setOpenAIHeaders(request *http.Request, apiKey string, accept string) {
	request.Header.Set("Content-Type", "application/json")
	if accept != "" {
		request.Header.Set("Accept", accept)
	} else {
		request.Header.Set("Accept", "application/json")
	}
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
}

func normalizeOpenAIBaseURL(value string) string {
	normalized := strings.TrimRight(strings.TrimSpace(value), "/")
	if normalized == "" {
		return defaultOpenAIBaseURL
	}
	return normalized
}

func readLimitedBody(reader io.Reader) string {
	data, _ := io.ReadAll(io.LimitReader(reader, 16*1024))
	return strings.TrimSpace(string(data))
}

type openAIModelsResponse struct {
	Data []openAIModel `json:"data"`
}

type openAIModel struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

type openAIChatCompletionRequest struct {
	Model            string               `json:"model"`
	Messages         []openAIMessage      `json:"messages"`
	Stream           bool                 `json:"stream,omitempty"`
	StreamOptions    *openAIStreamOptions `json:"stream_options,omitempty"`
	Tools            []openAITool         `json:"tools,omitempty"`
	ToolChoice       any                  `json:"tool_choice,omitempty"`
	ReasoningEffort  string               `json:"reasoning_effort,omitempty"`
	Temperature      *float32             `json:"temperature,omitempty"`
	TopP             *float32             `json:"top_p,omitempty"`
	FrequencyPenalty *float32             `json:"frequency_penalty,omitempty"`
	PresencePenalty  *float32             `json:"presence_penalty,omitempty"`
	MaxTokens        *int                 `json:"max_tokens,omitempty"`
}

type openAIStreamOptions struct {
	IncludeUsage bool `json:"include_usage,omitempty"`
}

type openAIMessage struct {
	Role       string           `json:"role"`
	Content    any              `json:"content"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
}

type openAIContentPart struct {
	Type     string              `json:"type"`
	Text     string              `json:"text,omitempty"`
	ImageURL *openAIImageURLPart `json:"image_url,omitempty"`
}

type openAIImageURLPart struct {
	URL string `json:"url"`
}

type openAITool struct {
	Type     string         `json:"type"`
	Function openAIFunction `json:"function"`
}

type openAIFunction struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Parameters  any    `json:"parameters,omitempty"`
	Strict      bool   `json:"strict,omitempty"`
}

type openAIToolCall struct {
	ID       string             `json:"id,omitempty"`
	Type     string             `json:"type"`
	Function openAIFunctionCall `json:"function"`
}

type openAIFunctionCall struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

type openAIChatCompletionChunk struct {
	Model   string         `json:"model"`
	Choices []openAIChoice `json:"choices"`
	Usage   *openAIUsage   `json:"usage,omitempty"`
}

type openAIChoice struct {
	Delta        openAIDelta `json:"delta"`
	FinishReason string      `json:"finish_reason"`
}

type openAIDelta struct {
	Content   string                `json:"content"`
	ToolCalls []openAIToolCallDelta `json:"tool_calls"`
}

type openAIToolCallDelta struct {
	Index    *int               `json:"index,omitempty"`
	ID       string             `json:"id,omitempty"`
	Type     string             `json:"type,omitempty"`
	Function openAIFunctionCall `json:"function,omitempty"`
}

type openAIUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

func buildOpenAIChatRequest(request ChatGenerationRequest) openAIChatCompletionRequest {
	chatRequest := openAIChatCompletionRequest{
		Model:         strings.TrimSpace(request.Model),
		Messages:      buildOpenAIMessages(request.Messages),
		Stream:        true,
		StreamOptions: &openAIStreamOptions{IncludeUsage: true},
	}
	if len(request.Tools) > 0 {
		chatRequest.Tools = buildOpenAITools(request.Tools)
	}
	if request.ToolChoice != nil {
		chatRequest.ToolChoice = request.ToolChoice
	}
	applyOpenAIAdvancedOptions(&chatRequest, request.Advanced)
	return chatRequest
}

func applyOpenAIAdvancedOptions(chatRequest *openAIChatCompletionRequest, advanced *ChatAdvancedOptions) {
	if advanced == nil {
		return
	}
	if advanced.Reasoning != nil {
		chatRequest.ReasoningEffort = normalizeReasoningEffort(advanced.Reasoning.Effort)
	}
	if advanced.Sampling != nil {
		if advanced.Sampling.Temperature != nil {
			value := clampFloat32(*advanced.Sampling.Temperature, 0, 2)
			chatRequest.Temperature = &value
		}
		if advanced.Sampling.TopP != nil {
			value := clampFloat32(*advanced.Sampling.TopP, 0, 1)
			chatRequest.TopP = &value
		}
	}
	if advanced.Penalties != nil {
		if advanced.Penalties.FrequencyPenalty != nil {
			value := clampFloat32(*advanced.Penalties.FrequencyPenalty, -2, 2)
			chatRequest.FrequencyPenalty = &value
		}
		if advanced.Penalties.PresencePenalty != nil {
			value := clampFloat32(*advanced.Penalties.PresencePenalty, -2, 2)
			chatRequest.PresencePenalty = &value
		}
	}
	if advanced.MaxTokens != nil && *advanced.MaxTokens > 0 {
		value := clampInt(*advanced.MaxTokens, 1, 200000)
		chatRequest.MaxTokens = &value
	}
}

func buildOpenAIMessages(messages []ProviderMessage) []openAIMessage {
	result := make([]openAIMessage, 0, len(messages))
	for _, message := range messages {
		switch strings.TrimSpace(message.Role) {
		case "assistant":
			result = append(result, buildOpenAIAssistantMessage(message))
		case "system":
			result = append(result, openAIMessage{Role: "system", Content: collectProviderMessageText(message.Parts)})
		case "tool":
			result = append(result, openAIMessage{Role: "tool", ToolCallID: strings.TrimSpace(message.ToolCallID), Content: collectProviderMessageText(message.Parts)})
		case "user":
			fallthrough
		default:
			result = append(result, openAIMessage{Role: "user", Content: buildOpenAIContent(message.Parts)})
		}
	}
	return result
}

func buildOpenAIAssistantMessage(message ProviderMessage) openAIMessage {
	toolCalls := make([]openAIToolCall, 0)
	for _, part := range message.Parts {
		if strings.TrimSpace(part.Type) != "toolCall" {
			continue
		}
		toolCalls = append(toolCalls, openAIToolCall{ID: strings.TrimSpace(part.ID), Type: "function", Function: openAIFunctionCall{Name: strings.TrimSpace(part.Name), Arguments: providerToolCallArguments(part)}})
	}
	var content any = ""
	if text := collectProviderMessageText(message.Parts); text != "" {
		content = text
	} else if len(toolCalls) > 0 {
		content = nil
	}
	return openAIMessage{Role: "assistant", Content: content, ToolCalls: toolCalls}
}

func buildOpenAIContent(parts []ProviderMessagePart) any {
	contentParts := make([]openAIContentPart, 0, len(parts))
	for _, part := range parts {
		switch strings.TrimSpace(part.Type) {
		case "image":
			if strings.TrimSpace(part.MimeType) != "" && strings.TrimSpace(part.Content) != "" {
				contentParts = append(contentParts, openAIContentPart{Type: "image_url", ImageURL: &openAIImageURLPart{URL: "data:" + strings.TrimSpace(part.MimeType) + ";base64," + strings.TrimSpace(part.Content)}})
			}
		case "text":
			if text := strings.TrimSpace(part.Text); text != "" {
				contentParts = append(contentParts, openAIContentPart{Type: "text", Text: text})
			}
		}
	}
	if len(contentParts) > 0 {
		return contentParts
	}
	return collectProviderMessageText(parts)
}

func buildOpenAITools(tools []ProviderTool) []openAITool {
	result := make([]openAITool, 0, len(tools))
	for _, tool := range tools {
		if strings.TrimSpace(tool.Name) == "" {
			continue
		}
		result = append(result, openAITool{Type: "function", Function: openAIFunction{Name: strings.TrimSpace(tool.Name), Description: strings.TrimSpace(tool.Description), Parameters: tool.Parameters, Strict: tool.Strict}})
	}
	return result
}

type openAIStreamAccumulator struct {
	model            string
	text             strings.Builder
	promptTokens     int64
	completionTokens int64
	totalTokens      int64
	toolCalls        []ProviderToolCall
	toolCallByIndex  map[int]int
}

func (accumulator *openAIStreamAccumulator) addChunk(chunk openAIChatCompletionChunk) ChatGenerationDelta {
	if strings.TrimSpace(chunk.Model) != "" {
		accumulator.model = strings.TrimSpace(chunk.Model)
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
		if len(choice.Delta.ToolCalls) > 0 {
			delta.ToolCalls = append(delta.ToolCalls, accumulator.mergeToolCalls(choice.Delta.ToolCalls)...)
		}
	}
	return delta
}

func (accumulator *openAIStreamAccumulator) mergeToolCalls(toolCalls []openAIToolCallDelta) []ProviderToolCall {
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

func (accumulator *openAIStreamAccumulator) result(providerLabel string, fallbackModel string) ChatGenerationResult {
	model := firstNonEmpty(accumulator.model, fallbackModel)
	return ChatGenerationResult{Model: model, ModelName: model, ModelDescription: providerLabel, OutputText: accumulator.text.String(), PromptTokens: accumulator.promptTokens, CompletionTokens: accumulator.completionTokens, TotalTokens: accumulator.totalTokens, ToolCalls: accumulator.toolCalls}
}

var _ = time.Second
