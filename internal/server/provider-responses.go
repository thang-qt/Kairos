package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Responses is explicit opt-in. It never falls back by guessing endpoint capabilities.
func (driver *OpenAICompatibleDriver) generateResponses(ctx context.Context, provider resolvedProvider, request ChatGenerationRequest, onDelta func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
	input := []any{}
	for _, message := range request.Messages {
		if message.Role == "system" {
			continue
		}
		if message.Role == "tool" {
			input = append(input, map[string]any{"type": "function_call_output", "call_id": message.ToolCallID, "output": collectProviderMessageText(message.Parts)})
			continue
		}
		content := []any{}
		for _, part := range message.Parts {
			switch part.Type {
			case "text":
				kind := "input_text"
				if message.Role == "assistant" {
					kind = "output_text"
				}
				content = append(content, map[string]any{"type": kind, "text": part.Text})
			case "image":
				content = append(content, map[string]any{"type": "input_image", "image_url": "data:" + part.MimeType + ";base64," + part.Content})
			}
		}
		if len(content) > 0 {
			input = append(input, map[string]any{"type": "message", "role": message.Role, "content": content})
		}
		for _, part := range message.Parts {
			if part.Type == "toolCall" {
				input = append(input, map[string]any{"type": "function_call", "call_id": part.ID, "name": part.Name, "arguments": providerToolCallArguments(part)})
			}
		}
	}
	body := map[string]any{"model": request.Model, "stream": true, "store": false, "input": input, "instructions": request.SystemPrompt}
	if len(request.Tools) > 0 {
		tools := []any{}
		for _, tool := range request.Tools {
			tools = append(tools, map[string]any{"type": "function", "name": tool.Name, "description": tool.Description, "parameters": tool.Parameters, "strict": tool.Strict})
		}
		body["tools"] = tools
		body["tool_choice"] = request.ToolChoice
	}
	if advanced := request.Advanced; advanced != nil {
		if advanced.Reasoning != nil {
			body["reasoning"] = map[string]any{"effort": normalizeReasoningEffort(advanced.Reasoning.Effort), "summary": "auto"}
		}
		if advanced.MaxTokens != nil {
			body["max_output_tokens"] = *advanced.MaxTokens
		}
		if advanced.Sampling != nil {
			if advanced.Sampling.Temperature != nil {
				body["temperature"] = *advanced.Sampling.Temperature
			}
			if advanced.Sampling.TopP != nil {
				body["top_p"] = *advanced.Sampling.TopP
			}
		}
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return ChatGenerationResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, normalizeOpenAIBaseURL(provider.BaseURL)+"/responses", bytes.NewReader(encoded))
	if err != nil {
		return ChatGenerationResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+provider.APIKey)
	client := driver.httpClient
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(req)
	if err != nil {
		return ChatGenerationResult{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
		return ChatGenerationResult{}, fmt.Errorf("Responses API HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}
	result := ChatGenerationResult{Model: request.Model}
	calls := map[string]int{}
	completed := false
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 8<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			continue
		}
		var event struct {
			Type   string `json:"type"`
			Delta  string `json:"delta"`
			ItemID string `json:"item_id"`
			Item   struct {
				ID        string `json:"id"`
				Type      string `json:"type"`
				CallID    string `json:"call_id"`
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			} `json:"item"`
			Response struct {
				Model string `json:"model"`
				Usage struct {
					Input  int64 `json:"input_tokens"`
					Output int64 `json:"output_tokens"`
					Total  int64 `json:"total_tokens"`
				} `json:"usage"`
				Error any `json:"error"`
			} `json:"response"`
			Error any `json:"error"`
		}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return result, fmt.Errorf("decode Responses event: %w", err)
		}
		delta := ChatGenerationDelta{}
		switch event.Type {
		case "response.output_text.delta":
			result.OutputText += event.Delta
			delta.Text = event.Delta
		case "response.reasoning_summary_text.delta":
			result.ThinkingText += event.Delta
			delta.Thinking = event.Delta
		case "response.output_item.added":
			if event.Item.Type == "function_call" {
				calls[event.Item.ID] = len(result.ToolCalls)
				call := ProviderToolCall{ID: event.Item.CallID, Name: event.Item.Name, ArgsJSON: event.Item.Arguments}
				result.ToolCalls = append(result.ToolCalls, call)
				delta.ToolCalls = []ProviderToolCall{call}
			}
		case "response.function_call_arguments.delta":
			if index, ok := calls[event.ItemID]; ok {
				call := &result.ToolCalls[index]
				call.ArgsJSON += event.Delta
				call.Args = parseToolCallArguments(call.ArgsJSON)
				delta.ToolCalls = []ProviderToolCall{*call}
			}
		case "response.output_item.done":
			if index, ok := calls[event.Item.ID]; ok {
				call := &result.ToolCalls[index]
				call.ArgsJSON = event.Item.Arguments
				call.Args = parseToolCallArguments(call.ArgsJSON)
				delta.ToolCalls = []ProviderToolCall{*call}
			}
		case "response.completed":
			completed = true
			result.Model = firstNonEmpty(event.Response.Model, result.Model)
			result.PromptTokens = event.Response.Usage.Input
			result.CompletionTokens = event.Response.Usage.Output
			result.TotalTokens = event.Response.Usage.Total
		case "error", "response.failed", "response.incomplete":
			return result, fmt.Errorf("Responses API %s: %v %v", event.Type, event.Error, event.Response.Error)
		}
		if delta.Text != "" || delta.Thinking != "" || len(delta.ToolCalls) > 0 {
			if err := onDelta(delta); err != nil {
				return result, err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return result, err
	}
	if !completed {
		return result, fmt.Errorf("Responses stream interrupted before completion")
	}
	return result, nil
}
