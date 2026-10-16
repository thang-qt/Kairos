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
			for _, message := range body["messages"].([]any) {
				if _, ok := message.(map[string]any)["phase"]; ok {
					t.Fatal("phase leaked to Chat Completions")
				}
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
			fmt.Fprint(writer, "data: {\"id\":\"completion-1\",\"object\":\"chat.completion.chunk\",\"created\":123,\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"type\":\"function\",\"function\":{\"name\":\"lookup\",\"arguments\":\"{\\\"query\\\":\\\"kai\"}}]}}]}\n\n")
			fmt.Fprint(writer, "data: {\"id\":\"completion-1\",\"object\":\"chat.completion.chunk\",\"created\":123,\"model\":\"gpt-test\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"ros\\\"}\"}}]}}]}\n\n")
			fmt.Fprint(writer, "data: {\"id\":\"completion-1\",\"object\":\"chat.completion.chunk\",\"created\":123,\"model\":\"gpt-test\",\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":5,\"total_tokens\":8}}\n\n")
			fmt.Fprint(writer, `data: {"id":"completion-1","object":"chat.completion.chunk","created":123,"model":"gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`+"\n\n")
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
				Parts: []ProviderMessagePart{{Type: "text", Text: "Search Kairos", Phase: "final_answer", PhaseSource: "provider"}},
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

func TestChatCompletionsStreamWithoutFinishFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(writer, `data: {"id":"partial","object":"chat.completion.chunk","model":"test-model","choices":[{"index":0,"delta":{"content":"partial"}}]}`+"\n\n")
	}))
	defer server.Close()
	driver := &OpenAICompatibleDriver{httpClient: server.Client()}
	observed := ""
	_, err := driver.GenerateChatStream(context.Background(), resolvedProvider{BaseURL: server.URL}, ChatGenerationRequest{Model: "test-model"}, func(delta ChatGenerationDelta) error { observed += delta.Text; return nil })
	if err == nil || observed != "partial" {
		t.Fatalf("truncated stream: output=%q error=%v", observed, err)
	}
}

func TestChatCompletionsFinishReasons(t *testing.T) {
	for _, scenario := range []struct {
		reason    string
		errorText string
	}{
		{reason: "stop"},
		{reason: "tool_calls"},
		{reason: "length", errorText: "Response truncated"},
		{reason: "content_filter", errorText: "content filtering"},
		{reason: "", errorText: "stream ended before completion"},
		{reason: "unexpected", errorText: "unexpected provider finish_reason"},
	} {
		t.Run(scenario.reason, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(writer, `data: {"object":"chat.completion.chunk","model":"test-model","choices":[{"index":0,"delta":{"content":"partial"}}]}`+"\n\n")
				fmt.Fprintf(writer, `data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":%q}]}`+"\n\n", scenario.reason)
				// A trailing usage-only chunk must not erase the finish reason.
				fmt.Fprint(writer, `data: {"object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}`+"\n\n")
				fmt.Fprint(writer, "data: [DONE]\n\n")
			}))
			defer server.Close()
			driver := &OpenAICompatibleDriver{httpClient: server.Client()}
			observed := ""
			result, err := driver.GenerateChatStream(context.Background(), resolvedProvider{BaseURL: server.URL}, ChatGenerationRequest{Model: "test-model"}, func(delta ChatGenerationDelta) error { observed += delta.Text; return nil })
			if scenario.errorText == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
			} else if err == nil || !strings.Contains(err.Error(), scenario.errorText) {
				t.Fatalf("error = %v, want %q", err, scenario.errorText)
			}
			if observed != "partial" || result.OutputText != "partial" || result.TotalTokens != 5 {
				t.Fatalf("output=%q result=%+v, want preserved partial response and usage", observed, result)
			}
		})
	}
}
