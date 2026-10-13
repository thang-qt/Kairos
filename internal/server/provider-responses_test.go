package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResponsesProtocolNormalizesTextReasoningToolsAndUsage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/responses" {
			t.Errorf("path=%s", request.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["store"] != false || body["stream"] != true {
			t.Errorf("request=%#v", body)
		}
		inputs := body["input"].([]any)
		if inputs[1].(map[string]any)["type"] != "function_call" || inputs[2].(map[string]any)["type"] != "function_call_output" {
			t.Errorf("tool ordering=%#v", inputs)
		}
		writer.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []string{
			`{"type":"response.reasoning_summary_text.delta","delta":"Available summary"}`,
			`{"type":"response.output_text.delta","delta":"answer"}`,
			`{"type":"response.output_item.added","item":{"id":"item","type":"function_call","call_id":"call","name":"math_eval","arguments":""}}`,
			`{"type":"response.function_call_arguments.delta","item_id":"item","delta":"{\"expression\":\"2+2\"}"}`,
			`{"type":"response.output_item.done","item":{"id":"item","type":"function_call","call_id":"call","name":"math_eval","arguments":"{\"expression\":\"2+2\"}"}}`,
			`{"type":"response.completed","response":{"model":"test-model","usage":{"input_tokens":4,"output_tokens":5,"total_tokens":9}}}`,
		} {
			fmt.Fprintf(writer, "data: %s\n\n", event)
		}
	}))
	defer server.Close()
	driver := &OpenAICompatibleDriver{httpClient: server.Client()}
	provider := resolvedProvider{BaseURL: server.URL + "/v1", APIKey: "test", Record: ProviderRecord{Kind: openAIResponsesProviderKind}}
	var deltas []ChatGenerationDelta
	result, err := driver.GenerateChatStream(context.Background(), provider, ChatGenerationRequest{Model: "test-model", Messages: []ProviderMessage{{Role: "user", Parts: []ProviderMessagePart{{Type: "text", Text: "calculate"}}}, {Role: "assistant", Parts: []ProviderMessagePart{{Type: "toolCall", ID: "prior", Name: "math_eval", ArgsJSON: "{}"}}}, {Role: "tool", ToolCallID: "prior", Parts: []ProviderMessagePart{{Type: "text", Text: "4"}}}}, Tools: buildRuntimeTools(false, true), ToolChoice: "auto"}, func(delta ChatGenerationDelta) error { deltas = append(deltas, delta); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if result.OutputText != "answer" || result.ThinkingText != "Available summary" || result.TotalTokens != 9 || len(result.ToolCalls) != 1 || result.ToolCalls[0].Args["expression"] != "2+2" {
		t.Fatalf("normalized result=%#v", result)
	}
	if len(deltas) != 5 {
		t.Fatalf("deltas=%d", len(deltas))
	}
}

func TestResponsesStreamWithoutCompletionFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(writer, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
	}))
	defer server.Close()
	driver := &OpenAICompatibleDriver{httpClient: server.Client()}
	_, err := driver.GenerateChatStream(context.Background(), resolvedProvider{BaseURL: server.URL, Record: ProviderRecord{Kind: openAIResponsesProviderKind}}, ChatGenerationRequest{Model: "test-model"}, func(ChatGenerationDelta) error { return nil })
	if err == nil {
		t.Fatal("truncated response was reported completed")
	}
}
