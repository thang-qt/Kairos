package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/packages/ssestream"
	"github.com/openai/openai-go/v3/shared"
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

	models, err := driver.client(provider).Models.List(ctx)
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
	progressObserver := newHermesToolProgressObserver()
	stream := driver.streamingClient(provider, progressObserver).Chat.Completions.NewStreaming(ctx, buildOpenAIChatRequest(request))
	defer stream.Close()

	processProgress := func() error {
		for _, progress := range progressObserver.drain() {
			if err := onDelta(ChatGenerationDelta{ToolProgress: []ProviderToolProgress{progress}}); err != nil {
				return err
			}
		}
		return nil
	}

	accumulator := openAIStreamAccumulator{}
	for stream.Next() {
		if err := processProgress(); err != nil {
			return ChatGenerationResult{}, err
		}
		delta := accumulator.addChunk(stream.Current())
		if delta.Text == "" && len(delta.ToolCalls) == 0 {
			continue
		}
		if err := onDelta(delta); err != nil {
			return ChatGenerationResult{}, err
		}
	}
	if err := stream.Err(); err != nil {
		return ChatGenerationResult{}, fmt.Errorf("stream OpenAI-compatible chat completion: %w", err)
	}
	<-progressObserver.done
	if err := processProgress(); err != nil {
		return ChatGenerationResult{}, err
	}
	return accumulator.result(provider.Record.Label, request.Model), nil
}

func (driver *OpenAICompatibleDriver) client(provider resolvedProvider) *openai.Client {
	return driver.clientWithHTTPClient(provider, driver.httpClient)
}

func (driver *OpenAICompatibleDriver) streamingClient(
	provider resolvedProvider,
	progressObserver *hermesToolProgressObserver,
) *openai.Client {
	httpClient := http.DefaultClient
	if driver.httpClient != nil {
		clientCopy := *driver.httpClient
		httpClient = &clientCopy
	}
	httpClient.Transport = &hermesToolProgressTransport{
		base:     httpClient.Transport,
		observer: progressObserver,
	}
	return driver.clientWithHTTPClient(provider, httpClient)
}

func (driver *OpenAICompatibleDriver) clientWithHTTPClient(
	provider resolvedProvider,
	httpClient *http.Client,
) *openai.Client {
	client := openai.NewClient(
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

const hermesToolProgressEvent = "hermes.tool.progress"

// hermesToolProgressObserver duplicates an SSE response before the OpenAI SDK
// decodes it. The SDK ignores Hermes's named progress events, while its normal
// Chat Completions chunks continue through the SDK unchanged.
type hermesToolProgressObserver struct {
	events chan ProviderToolProgress
	done   chan struct{}
	once   sync.Once
}

func newHermesToolProgressObserver() *hermesToolProgressObserver {
	return &hermesToolProgressObserver{
		events: make(chan ProviderToolProgress, 128),
		done:   make(chan struct{}),
	}
}

func (observer *hermesToolProgressObserver) observe(event ssestream.Event) {
	if event.Type != hermesToolProgressEvent {
		return
	}
	var progress ProviderToolProgress
	if err := json.Unmarshal(bytes.TrimSpace(event.Data), &progress); err != nil {
		return
	}
	progress.ID = strings.TrimSpace(progress.ID)
	progress.Name = strings.TrimSpace(progress.Name)
	progress.Label = strings.TrimSpace(progress.Label)
	progress.Emoji = strings.TrimSpace(progress.Emoji)
	progress.Status = strings.TrimSpace(progress.Status)
	if progress.ID == "" || progress.Name == "" || progress.Status == "" {
		return
	}
	observer.events <- progress
}

func (observer *hermesToolProgressObserver) drain() []ProviderToolProgress {
	result := make([]ProviderToolProgress, 0)
	for {
		select {
		case progress := <-observer.events:
			result = append(result, progress)
		default:
			return result
		}
	}
}

func (observer *hermesToolProgressObserver) finish() {
	observer.once.Do(func() {
		close(observer.done)
	})
}

type hermesToolProgressTransport struct {
	base     http.RoundTripper
	observer *hermesToolProgressObserver
}

func (transport *hermesToolProgressTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	base := transport.base
	if base == nil {
		base = http.DefaultTransport
	}
	response, err := base.RoundTrip(request)
	if err != nil || response == nil || response.Body == nil || !strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
		transport.observer.finish()
		return response, err
	}

	reader, writer := io.Pipe()
	response.Body = &hermesObservedResponseBody{
		source: response.Body,
		writer: writer,
	}
	go func() {
		defer transport.observer.finish()
		defer reader.Close()
		decoder := ssestream.NewDecoder(&http.Response{
			Header: response.Header,
			Body:   reader,
		})
		for decoder.Next() {
			transport.observer.observe(decoder.Event())
		}
	}()
	return response, nil
}

type hermesObservedResponseBody struct {
	source    io.ReadCloser
	writer    *io.PipeWriter
	closeOnce sync.Once
}

func (body *hermesObservedResponseBody) Read(buffer []byte) (int, error) {
	count, err := body.source.Read(buffer)
	if count > 0 {
		if _, writeErr := body.writer.Write(buffer[:count]); writeErr != nil {
			return count, writeErr
		}
	}
	if err != nil {
		body.closeWriter()
	}
	return count, err
}

func (body *hermesObservedResponseBody) Close() error {
	body.closeWriter()
	return body.source.Close()
}

func (body *hermesObservedResponseBody) closeWriter() {
	body.closeOnce.Do(func() {
		_ = body.writer.Close()
	})
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
	toolCalls := make([]openai.ChatCompletionMessageToolCallUnionParam, 0)
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
			if text := strings.TrimSpace(part.Text); text != "" {
				contentParts = append(contentParts, openai.TextContentPart(text))
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
	model            string
	text             strings.Builder
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
