package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/shared"
)

const openAIProviderKind = "openai"
const defaultOpenAIBaseURL = "https://api.openai.com/v1"

type OpenAICompatibleDriver struct {
	httpClient          *http.Client
	secureUserProviders bool
}

func (driver *OpenAICompatibleDriver) Kind() string { return openAIProviderKind }

func (driver *OpenAICompatibleDriver) ListModels(ctx context.Context, provider resolvedProvider) ([]ProviderModel, error) {
	if strings.TrimSpace(provider.APIKey) == "" {
		return modelsFromStaticList(provider.StaticModels, provider.Record), nil
	}

	client, httpClient := driver.client(provider)
	defer driver.closeUserProviderConnections(provider, httpClient)
	models, err := client.Models.List(ctx)
	if err != nil {
		if len(provider.StaticModels) > 0 {
			return modelsFromStaticList(provider.StaticModels, provider.Record), nil
		}
		return nil, fmt.Errorf("list OpenAI-compatible models: %w", err)
	}

	result := make([]ProviderModel, 0, len(models.Data))
	for _, model := range models.Data {
		if strings.TrimSpace(model.ID) == "" {
			continue
		}
		result = append(result, ProviderModel{
			ID:            strings.TrimSpace(model.ID),
			Object:        firstNonEmpty(string(model.Object), "model"),
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
	if provider.Record.UseResponsesAPI || provider.Record.Kind == openAIResponsesProviderKind {
		return driver.generateResponses(ctx, provider, request, onDelta)
	}
	client, httpClient := driver.client(provider)
	defer driver.closeUserProviderConnections(provider, httpClient)
	stream := client.Chat.Completions.NewStreaming(ctx, buildOpenAIChatRequest(request))
	defer stream.Close()

	accumulator := openAIStreamAccumulator{}
	for stream.Next() {
		delta := accumulator.addChunk(stream.Current())
		if delta.Text == "" && delta.Thinking == "" && len(delta.ToolCalls) == 0 {
			continue
		}
		if err := onDelta(delta); err != nil {
			return ChatGenerationResult{}, err
		}
	}
	if err := stream.Err(); err != nil {
		return ChatGenerationResult{}, fmt.Errorf("stream OpenAI-compatible chat completion: %w", normalizeProviderHTTPError(err))
	}
	result := accumulator.result(provider.Record.Label, request.Model)
	result.Details = map[string]any{"finishReason": accumulator.finishReason}
	switch accumulator.finishReason {
	case "stop", "tool_calls":
		return result, nil
	case "length":
		return result, fmt.Errorf("Response truncated: the provider reached its output-token limit (finish_reason: length)")
	case "content_filter":
		return result, fmt.Errorf("Response incomplete: the provider stopped generation due to content filtering (finish_reason: content_filter)")
	case "":
		return result, fmt.Errorf("Chat Completions stream ended before completion")
	default:
		return result, fmt.Errorf("Response incomplete: unexpected provider finish_reason %q", accumulator.finishReason)
	}
}

func (driver *OpenAICompatibleDriver) client(provider resolvedProvider) (*openai.Client, *http.Client) {
	httpClient := driver.httpClientForProvider(provider)
	return driver.clientWithHTTPClient(provider, httpClient), httpClient
}

func (driver *OpenAICompatibleDriver) httpClientForProvider(provider resolvedProvider) *http.Client {
	if !driver.secureUserProviders || provider.Record.Owner != "user" {
		return driver.httpClient
	}
	client, err := newProviderHTTPClient(normalizeOpenAIBaseURL(provider.BaseURL))
	if err != nil {
		return &http.Client{Transport: providerRejectTransport{err: err}}
	}
	return client
}

type providerRejectTransport struct{ err error }

func (transport providerRejectTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, transport.err
}

func (driver *OpenAICompatibleDriver) closeUserProviderConnections(provider resolvedProvider, client *http.Client) {
	if driver.secureUserProviders && provider.Record.Owner == "user" && client != nil {
		client.CloseIdleConnections()
	}
}

func (driver *OpenAICompatibleDriver) clientWithHTTPClient(
	provider resolvedProvider,
	httpClient *http.Client,
) *openai.Client {
	client := openai.NewClient(
		option.WithMaxRetries(0),
		option.WithAPIKey(strings.TrimSpace(provider.APIKey)),
		option.WithBaseURL(normalizeOpenAIBaseURL(provider.BaseURL)),
		option.WithHTTPClient(httpClient),
	)
	return &client
}

func normalizeOpenAIBaseURL(value string) string {
	normalized := strings.TrimRight(strings.TrimSpace(value), "/")
	if normalized == "" {
		return defaultOpenAIBaseURL
	}
	return normalized
}

func buildOpenAIChatRequest(request ChatGenerationRequest) openai.ChatCompletionNewParams {
	chatRequest := openai.ChatCompletionNewParams{
		Model:    strings.TrimSpace(request.Model),
		Messages: buildOpenAIMessages(request.Messages),
		StreamOptions: openai.ChatCompletionStreamOptionsParam{
			IncludeUsage: param.NewOpt(true),
		},
	}
	if len(request.Tools) > 0 {
		chatRequest.Tools = buildOpenAITools(request.Tools)
	}
	if toolChoice, ok := buildOpenAIToolChoice(request.ToolChoice); ok {
		chatRequest.ToolChoice = toolChoice
	}
	applyOpenAIAdvancedOptions(&chatRequest, request.Advanced)
	return chatRequest
}

func buildOpenAIToolChoice(value any) (openai.ChatCompletionToolChoiceOptionUnionParam, bool) {
	choice, ok := value.(string)
	if !ok || strings.TrimSpace(choice) == "" {
		return openai.ChatCompletionToolChoiceOptionUnionParam{}, false
	}
	return openai.ChatCompletionToolChoiceOptionUnionParam{OfAuto: param.NewOpt(strings.TrimSpace(choice))}, true
}

func applyOpenAIAdvancedOptions(chatRequest *openai.ChatCompletionNewParams, advanced *ChatAdvancedOptions) {
	if advanced == nil {
		return
	}
	if advanced.Reasoning != nil {
		chatRequest.ReasoningEffort = shared.ReasoningEffort(normalizeReasoningEffort(advanced.Reasoning.Effort))
	}
	if advanced.Sampling != nil {
		if advanced.Sampling.Temperature != nil {
			chatRequest.Temperature = param.NewOpt(float64(clampFloat32(*advanced.Sampling.Temperature, 0, 2)))
		}
		if advanced.Sampling.TopP != nil {
			chatRequest.TopP = param.NewOpt(float64(clampFloat32(*advanced.Sampling.TopP, 0, 1)))
		}
	}
	if advanced.Penalties != nil {
		if advanced.Penalties.FrequencyPenalty != nil {
			chatRequest.FrequencyPenalty = param.NewOpt(float64(clampFloat32(*advanced.Penalties.FrequencyPenalty, -2, 2)))
		}
		if advanced.Penalties.PresencePenalty != nil {
			chatRequest.PresencePenalty = param.NewOpt(float64(clampFloat32(*advanced.Penalties.PresencePenalty, -2, 2)))
		}
	}
	if advanced.MaxTokens != nil && *advanced.MaxTokens > 0 {
		chatRequest.MaxTokens = param.NewOpt(int64(clampInt(*advanced.MaxTokens, 1, 200000)))
	}
}

func buildOpenAIMessages(messages []ProviderMessage) []openai.ChatCompletionMessageParamUnion {
	result := make([]openai.ChatCompletionMessageParamUnion, 0, len(messages))
	for _, message := range messages {
		switch strings.TrimSpace(message.Role) {
		case "assistant":
			result = append(result, buildOpenAIAssistantMessage(message))
		case "system":
			result = append(result, openai.SystemMessage(collectProviderMessageText(message.Parts)))
		case "tool":
			result = append(result, openai.ToolMessage(collectProviderMessageText(message.Parts), strings.TrimSpace(message.ToolCallID)))
		case "user":
			fallthrough
		default:
			result = append(result, openai.UserMessage(buildOpenAIContent(message.Parts)))
		}
	}
	return result
}

func buildOpenAIAssistantMessage(message ProviderMessage) openai.ChatCompletionMessageParamUnion {
	var toolCalls []openai.ChatCompletionMessageToolCallUnionParam
	for _, part := range message.Parts {
		if strings.TrimSpace(part.Type) != "toolCall" {
			continue
		}
		functionCall := openai.ChatCompletionMessageFunctionToolCallParam{
			ID: strings.TrimSpace(part.ID),
			Function: openai.ChatCompletionMessageFunctionToolCallFunctionParam{
				Name:      strings.TrimSpace(part.Name),
				Arguments: providerToolCallArguments(part),
			},
		}
		toolCalls = append(toolCalls, openai.ChatCompletionMessageToolCallUnionParam{OfFunction: &functionCall})
	}

	assistant := openai.ChatCompletionAssistantMessageParam{ToolCalls: toolCalls}
	if text := collectProviderMessageText(message.Parts); text != "" {
		assistant.Content.OfString = param.NewOpt(text)
	}
	return openai.ChatCompletionMessageParamUnion{OfAssistant: &assistant}
}

func buildOpenAIContent(parts []ProviderMessagePart) []openai.ChatCompletionContentPartUnionParam {
	contentParts := make([]openai.ChatCompletionContentPartUnionParam, 0, len(parts))
	for _, part := range parts {
		switch strings.TrimSpace(part.Type) {
		case "image":
			if strings.TrimSpace(part.MimeType) != "" && strings.TrimSpace(part.Content) != "" {
				contentParts = append(contentParts, openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{
					URL: "data:" + strings.TrimSpace(part.MimeType) + ";base64," + strings.TrimSpace(part.Content),
				}))
			}
		case "text":
			if part.Text != "" {
				contentParts = append(contentParts, openai.TextContentPart(part.Text))
			}
		}
	}
	if len(contentParts) > 0 {
		return contentParts
	}
	return []openai.ChatCompletionContentPartUnionParam{openai.TextContentPart(collectProviderMessageText(parts))}
}

func buildOpenAITools(tools []ProviderTool) []openai.ChatCompletionToolUnionParam {
	result := make([]openai.ChatCompletionToolUnionParam, 0, len(tools))
	for _, tool := range tools {
		if strings.TrimSpace(tool.Name) == "" {
			continue
		}
		function := openai.ChatCompletionFunctionToolParam{Function: shared.FunctionDefinitionParam{
			Name:        strings.TrimSpace(tool.Name),
			Description: param.NewOpt(strings.TrimSpace(tool.Description)),
			Parameters:  openAIFunctionParameters(tool.Parameters),
			Strict:      param.NewOpt(tool.Strict),
		}}
		result = append(result, openai.ChatCompletionToolUnionParam{OfFunction: &function})
	}
	return result
}

func openAIFunctionParameters(value any) shared.FunctionParameters {
	if parameters, ok := value.(map[string]any); ok {
		return shared.FunctionParameters(parameters)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var parameters shared.FunctionParameters
	if err := json.Unmarshal(encoded, &parameters); err != nil {
		return nil
	}
	return parameters
}

type openAIStreamAccumulator struct {
	finishReason     string
	model            string
	text             strings.Builder
	thinking         strings.Builder
	promptTokens     int64
	completionTokens int64
	totalTokens      int64
	toolCalls        []ProviderToolCall
	toolCallByIndex  map[int64]int
}

func (accumulator *openAIStreamAccumulator) addChunk(chunk openai.ChatCompletionChunk) ChatGenerationDelta {
	if strings.TrimSpace(chunk.Model) != "" {
		accumulator.model = strings.TrimSpace(chunk.Model)
	}
	if chunk.Usage.JSON.PromptTokens.Valid() {
		accumulator.promptTokens = chunk.Usage.PromptTokens
		accumulator.completionTokens = chunk.Usage.CompletionTokens
		accumulator.totalTokens = chunk.Usage.TotalTokens
	}
	var delta ChatGenerationDelta
	for _, choice := range chunk.Choices {
		if choice.FinishReason != "" {
			accumulator.finishReason = choice.FinishReason
		}
		for _, key := range []string{"reasoning_content", "reasoning"} {
			if field, ok := choice.Delta.JSON.ExtraFields[key]; ok {
				var thinking string
				if json.Unmarshal([]byte(field.Raw()), &thinking) == nil {
					accumulator.thinking.WriteString(thinking)
					delta.Thinking += thinking
					break
				}
			}
		}
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

func (accumulator *openAIStreamAccumulator) mergeToolCalls(toolCalls []openai.ChatCompletionChunkChoiceDeltaToolCall) []ProviderToolCall {
	if accumulator.toolCallByIndex == nil {
		accumulator.toolCallByIndex = make(map[int64]int)
	}
	changed := make([]ProviderToolCall, 0, len(toolCalls))
	for _, toolCall := range toolCalls {
		index, ok := accumulator.toolCallByIndex[toolCall.Index]
		if !ok {
			index = len(accumulator.toolCalls)
			accumulator.toolCallByIndex[toolCall.Index] = index
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
