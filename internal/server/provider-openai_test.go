package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAICompatibleDriverUsesOfficialSDKForModelsAndStreaming(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer sk-test" {
			t.Errorf("authorization = %q, want bearer API key", request.Header.Get("Authorization"))
		}

		switch request.URL.Path {
		case "/v1/models":
			if request.Method != http.MethodGet {
				t.Errorf("models method = %s, want GET", request.Method)
			}
			writer.Header().Set("Content-Type", "application/json")
			fmt.Fprint(writer, `{"object":"list","data":[{"id":"gpt-test","object":"model","created":123,"owned_by":"test"}]}`)
		case "/v1/chat/completions":
			if request.Method != http.MethodPost {
				t.Errorf("chat method = %s, want POST", request.Method)
			}
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Errorf("decode chat request: %v", err)
				return
			}
			if stream, _ := body["stream"].(bool); !stream {
				t.Errorf("stream = %v, want true", body["stream"])
			}
			streamOptions, _ := body["stream_options"].(map[string]any)
			if includeUsage, _ := streamOptions["include_usage"].(bool); !includeUsage {
				t.Errorf("stream_options.include_usage = %v, want true", streamOptions["include_usage"])
			}
			if tools, _ := body["tools"].([]any); len(tools) != 1 {
				t.Errorf("tools = %#v, want one function tool", body["tools"])
			}

			writer.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(writer, "data: {\"id\":\"completion-1\",\"object\":\"chat.completion.chunk\",\"created\":123,\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello \"}}]}\n\n")
			fmt.Fprint(writer, "event: hermes.tool.progress\ndata: {\"tool\":\"terminal\",\"emoji\":\"💻\",\"label\":\"pwd\",\"toolCallId\":\"call-hermes\",\"status\":\"running\"}\n\n")
			fmt.Fprint(writer, "event: hermes.tool.progress\ndata: {\"tool\":\"terminal\",\"toolCallId\":\"call-hermes\",\"status\":\"completed\"}\n\n")
			fmt.Fprint(writer, "data: {\"id\":\"completion-1\",\"object\":\"chat.completion.chunk\",\"created\":123,\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"type\":\"function\",\"function\":{\"name\":\"lookup\",\"arguments\":\"{\\\"query\\\":\\\"kai\"}}]}}]}\n\n")
			fmt.Fprint(writer, "data: {\"id\":\"completion-1\",\"object\":\"chat.completion.chunk\",\"created\":123,\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"ros\\\"}\"}}]}}]}\n\n")
			fmt.Fprint(writer, "data: {\"id\":\"completion-1\",\"object\":\"chat.completion.chunk\",\"created\":123,\"model\":\"gpt-test\",\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":5,\"total_tokens\":8}}\n\n")
			fmt.Fprint(writer, "data: [DONE]\n\n")
		default:
			t.Errorf("unexpected path %s", request.URL.Path)
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	provider := resolvedProvider{
		Record:  ProviderRecord{Ref: "provider:test", Label: "Test provider"},
		BaseURL: server.URL + "/v1",
		APIKey:  "sk-test",
	}
	driver := &OpenAICompatibleDriver{httpClient: server.Client()}

	models, err := driver.ListModels(context.Background(), provider)
	if err != nil {
		t.Fatalf("ListModels() error = %v", err)
	}
	if len(models) != 1 || models[0].ID != "gpt-test" || models[0].OwnedBy != "test" {
		t.Fatalf("models = %#v, want gpt-test", models)
	}

	var deltas []ChatGenerationDelta
	result, err := driver.GenerateChatStream(
		context.Background(),
		provider,
		ChatGenerationRequest{
			Model: "gpt-test",
			Messages: []ProviderMessage{{
				Role:  "user",
				Parts: []ProviderMessagePart{{Type: "text", Text: "Search Kairos"}},
			}},
			Tools: []ProviderTool{{
				Name:       "lookup",
				Parameters: map[string]any{"type": "object"},
			}},
			ToolChoice: "auto",
		},
		func(delta ChatGenerationDelta) error {
			deltas = append(deltas, delta)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("GenerateChatStream() error = %v", err)
	}
	if result.OutputText != "Hello " || result.PromptTokens != 3 || result.CompletionTokens != 5 || result.TotalTokens != 8 {
		t.Fatalf("result = %#v, want streamed text and usage", result)
	}
	if len(result.ToolCalls) != 1 || result.ToolCalls[0].ID != "call-1" || result.ToolCalls[0].Name != "lookup" || result.ToolCalls[0].ArgsJSON != `{"query":"kairos"}` {
		t.Fatalf("tool calls = %#v, want merged lookup call", result.ToolCalls)
	}
	if len(deltas) < 3 || !containsOpenAITextDelta(deltas, "Hello ") || !containsOpenAIToolCallDelta(deltas, "kairos") {
		t.Fatalf("deltas = %#v, want text and incremental tool-call deltas", deltas)
	}
	if progress := lastHermesToolProgress(deltas); progress.ID != "call-hermes" || progress.Name != "terminal" || progress.Label != "pwd" || progress.Status != "completed" {
		t.Fatalf("Hermes tool progress = %#v, want completed terminal pwd", progress)
	}
}

func containsOpenAITextDelta(deltas []ChatGenerationDelta, text string) bool {
	for _, delta := range deltas {
		if delta.Text == text {
			return true
		}
	}
	return false
}

func containsOpenAIToolCallDelta(deltas []ChatGenerationDelta, arguments string) bool {
	for _, delta := range deltas {
		for _, call := range delta.ToolCalls {
			if strings.Contains(call.ArgsJSON, arguments) {
				return true
			}
		}
	}
	return false
}

func lastHermesToolProgress(deltas []ChatGenerationDelta) ProviderToolProgress {
	var progress []ProviderToolProgress
	for _, delta := range deltas {
		progress = mergeProviderToolProgress(progress, delta.ToolProgress)
	}
	if len(progress) == 0 {
		return ProviderToolProgress{}
	}
	return progress[len(progress)-1]
}
