package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

const openAICompatibleProviderKind = "openai_compatible"
const defaultProviderKind = openAICompatibleProviderKind

type OpenAICompatibleDriver struct {
	httpClient *http.Client
}

func defaultProviderDrivers() map[string]ProviderDriver {
	return map[string]ProviderDriver{
		openAICompatibleProviderKind: &OpenAICompatibleDriver{
			httpClient: &http.Client{Timeout: 10 * time.Second},
		},
	}
}

func (driver *OpenAICompatibleDriver) Kind() string {
	return openAICompatibleProviderKind
}

func (driver *OpenAICompatibleDriver) ListModels(
	ctx context.Context,
	provider resolvedProvider,
) ([]ProviderModel, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(provider.BaseURL), "/")
	if baseURL == "" || strings.TrimSpace(provider.APIKey) == "" {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/models", nil)
	if err != nil {
		return nil, fmt.Errorf("build model request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+provider.APIKey)

	response, err := driver.httpClient.Do(request)
	if err != nil {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}

	var payload struct {
		Data []struct {
			ID      string `json:"id"`
			Object  string `json:"object"`
			Created int64  `json:"created"`
			OwnedBy string `json:"owned_by"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}

	models := make([]ProviderModel, 0, len(payload.Data))
	for _, item := range payload.Data {
		if strings.TrimSpace(item.ID) == "" {
			continue
		}
		models = append(models, ProviderModel{
			ID:            item.ID,
			Object:        "model",
			Created:       item.Created,
			OwnedBy:       fallbackString(item.OwnedBy, provider.Record.Label),
			ProviderRef:   provider.Record.Ref,
			ProviderLabel: provider.Record.Label,
		})
	}
	if len(models) == 0 {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}
	slices.SortFunc(models, func(left ProviderModel, right ProviderModel) int {
		return strings.Compare(left.ID, right.ID)
	})
	return models, nil
}

func (driver *OpenAICompatibleDriver) GenerateChatStream(
	ctx context.Context,
	provider resolvedProvider,
	request ChatGenerationRequest,
	onDelta func(delta ChatGenerationDelta) error,
) (ChatGenerationResult, error) {
	client := openai.NewClient(driver.requestOptions(provider)...)
	params := openai.ChatCompletionNewParams{
		Messages: buildOpenAIChatMessages(request.Messages),
		Model:    openai.ChatModel(strings.TrimSpace(request.Model)),
		StreamOptions: openai.ChatCompletionStreamOptionsParam{
			IncludeUsage: openai.Bool(true),
		},
	}
	if normalizedReasoningEffort := normalizeOpenAIReasoningEffort(request.ReasoningEffort); normalizedReasoningEffort != "" {
		params.ReasoningEffort = normalizedReasoningEffort
	}
	if request.Temperature != nil {
		params.Temperature = openai.Float(*request.Temperature)
	}
	if request.TopP != nil {
		params.TopP = openai.Float(*request.TopP)
	}
	if request.MaxOutputTokens != nil {
		params.MaxCompletionTokens = openai.Int(*request.MaxOutputTokens)
	}

	stream := client.Chat.Completions.NewStreaming(ctx, params)
	defer stream.Close()

	accumulator := openai.ChatCompletionAccumulator{}
	accumulatedThinking := ""
	for stream.Next() {
		chunk := stream.Current()
		accumulator.AddChunk(chunk)
		if len(chunk.Choices) == 0 {
			continue
		}
		if reasoningDelta := extractChatCompletionReasoningDelta(chunk); reasoningDelta != "" {
			accumulatedThinking = mergeOpenAIStreamText(
				accumulatedThinking,
				reasoningDelta,
			)
			if err := onDelta(ChatGenerationDelta{Thinking: reasoningDelta}); err != nil {
				return ChatGenerationResult{}, err
			}
		}
		delta := chunk.Choices[0].Delta.Content
		if delta == "" {
			continue
		}
		if err := onDelta(ChatGenerationDelta{Text: delta}); err != nil {
			return ChatGenerationResult{}, err
		}
	}
	if err := stream.Err(); err != nil {
		return ChatGenerationResult{}, fmt.Errorf("stream chat completion: %w", err)
	}

	outputText := ""
	if len(accumulator.Choices) > 0 {
		outputText = accumulator.Choices[0].Message.Content
	}
	modelID := strings.TrimSpace(accumulator.Model)
	if modelID == "" {
		modelID = strings.TrimSpace(request.Model)
	}

	return ChatGenerationResult{
		Model:            modelID,
		ModelDescription: provider.Record.Label,
		ThinkingText:     strings.TrimSpace(accumulatedThinking),
		OutputText:       outputText,
		PromptTokens:     accumulator.Usage.PromptTokens,
		CompletionTokens: accumulator.Usage.CompletionTokens,
		TotalTokens:      accumulator.Usage.TotalTokens,
	}, nil
}

func (driver *OpenAICompatibleDriver) requestOptions(provider resolvedProvider) []option.RequestOption {
	options := []option.RequestOption{
		option.WithAPIKey(strings.TrimSpace(provider.APIKey)),
	}
	if baseURL := normalizeProviderBaseURL(provider.BaseURL); baseURL != "" {
		options = append(options, option.WithBaseURL(baseURL))
	}
	return options
}

func normalizeOpenAIReasoningEffort(value string) openai.ReasoningEffort {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "low":
		return openai.ReasoningEffortLow
	case "medium":
		return openai.ReasoningEffortMedium
	case "high":
		return openai.ReasoningEffortHigh
	default:
		return ""
	}
}

func extractChatCompletionReasoningDelta(chunk openai.ChatCompletionChunk) string {
	if len(chunk.Choices) == 0 {
		return ""
	}
	return extractReasoningContentFromRawJSON(
		chunk.Choices[0].Delta.JSON.ExtraFields["reasoning_content"].Raw(),
	)
}

func extractReasoningContentFromRawJSON(raw string) string {
	normalizedRaw := strings.TrimSpace(raw)
	if normalizedRaw == "" {
		return ""
	}

	var text string
	if err := json.Unmarshal([]byte(normalizedRaw), &text); err == nil {
		return text
	}

	var textParts []string
	if err := json.Unmarshal([]byte(normalizedRaw), &textParts); err == nil {
		return strings.Join(textParts, "")
	}

	var contentParts []map[string]any
	if err := json.Unmarshal([]byte(normalizedRaw), &contentParts); err == nil {
		fragments := make([]string, 0, len(contentParts))
		for _, part := range contentParts {
			textValue, _ := part["text"].(string)
			textValue = strings.TrimSpace(textValue)
			if textValue != "" {
				fragments = append(fragments, textValue)
			}
		}
		return strings.Join(fragments, "")
	}

	return ""
}

func mergeOpenAIStreamText(current string, next string) string {
	if next == "" {
		return current
	}
	if current == "" {
		return next
	}
	if strings.HasPrefix(next, current) {
		return next
	}
	if strings.HasSuffix(current, next) {
		return current
	}
	return current + next
}

func buildOpenAIChatMessages(messages []ProviderMessage) []openai.ChatCompletionMessageParamUnion {
	params := make([]openai.ChatCompletionMessageParamUnion, 0, len(messages))
	for _, message := range messages {
		switch strings.TrimSpace(message.Role) {
		case "assistant":
			text := collectProviderMessageText(message.Parts)
			if text == "" {
				continue
			}
			params = append(params, openai.AssistantMessage(text))
		case "system":
			text := collectProviderMessageText(message.Parts)
			if text == "" {
				continue
			}
			params = append(params, openai.SystemMessage(text))
		default:
			parts := buildOpenAIMessageParts(message.Parts)
			if len(parts) == 0 {
				continue
			}
			params = append(params, openai.UserMessage(parts))
		}
	}
	return params
}

func buildOpenAIMessageParts(parts []ProviderMessagePart) []openai.ChatCompletionContentPartUnionParam {
	result := make([]openai.ChatCompletionContentPartUnionParam, 0, len(parts))
	for _, part := range parts {
		switch strings.TrimSpace(part.Type) {
		case "image":
			if dataURL := imageDataURL(part.MimeType, part.Content); dataURL != "" {
				result = append(result, openai.ImageContentPart(
					openai.ChatCompletionContentPartImageImageURLParam{
						URL: dataURL,
					},
				))
			}
		default:
			if text := strings.TrimSpace(part.Text); text != "" {
				result = append(result, openai.TextContentPart(text))
			}
		}
	}
	return result
}
