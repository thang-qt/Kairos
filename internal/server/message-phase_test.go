package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestResponsesMessagePhasesStreamAndReplay(t *testing.T) {
	var inputs []any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		inputs = body["input"].([]any)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []string{
			`{"type":"response.output_item.added","item":{"id":"narration","type":"message","phase":"commentary"}}`,
			`{"type":"response.output_text.delta","item_id":"narration","delta":"Looking up."}`,
			`{"type":"response.output_item.added","item":{"id":"tool","type":"function_call","call_id":"call","name":"lookup","arguments":"{}"}}`,
			`{"type":"response.output_item.added","item":{"id":"answer","type":"message"}}`,
			`{"type":"response.output_text.delta","item_id":"answer","delta":"Found it."}`,
			`{"type":"response.output_item.done","item":{"id":"answer","type":"message","phase":"final_answer"}}`,
			`{"type":"response.completed","response":{"model":"fixture"}}`,
		} {
			fmt.Fprintf(w, "data: %s\n\n", event)
		}
	}))
	defer server.Close()
	driver := &OpenAICompatibleDriver{httpClient: server.Client()}
	request := ChatGenerationRequest{Model: "fixture", Messages: []ProviderMessage{{Role: "assistant", Parts: []ProviderMessagePart{
		{Type: "text", Text: "Provider commentary", Phase: "commentary", PhaseSource: "provider"},
		{Type: "text", Text: "Derived narration", Phase: "commentary", PhaseSource: "derived"},
		{Type: "text", Text: "Provider answer", Phase: "final_answer", PhaseSource: "provider"},
	}}}}
	var deltas []ChatGenerationDelta
	result, err := driver.generateResponses(context.Background(), resolvedProvider{BaseURL: server.URL}, request, func(delta ChatGenerationDelta) error {
		delta.TextSegments = append([]ProviderTextSegment(nil), delta.TextSegments...)
		deltas = append(deltas, delta)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.OutputText != "Looking up.Found it." || len(result.TextSegments) != 2 {
		t.Fatalf("result=%#v", result)
	}
	if deltas[0].Phase != "commentary" || deltas[len(deltas)-1].TextSegments[1].Phase != "final_answer" {
		t.Fatalf("deltas=%#v", deltas)
	}
	deriveResultPhases(&result)
	if result.TextSegments[1].Phase != "final_answer" || result.TextSegments[1].PhaseSource != "provider" {
		t.Fatal("provider final overwritten by tool-round derivation")
	}
	if len(inputs) != 3 || inputs[0].(map[string]any)["phase"] != "commentary" || inputs[1].(map[string]any)["phase"] != nil || inputs[2].(map[string]any)["phase"] != "final_answer" {
		t.Fatalf("phase replay=%#v", inputs)
	}
	content := buildAssistantContent("", result.OutputText, result.ToolCalls, result.TextSegments...)
	data, _ := json.Marshal(contentPartsToMaps(content))
	var stored []map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	replay := extractProviderMessageParts(stored)
	if !reflect.DeepEqual(replay, providerPartsFromResult(result)) {
		t.Fatalf("persisted replay=%#v, result=%#v", replay, providerPartsFromResult(result))
	}
}

func TestDeriveMessagePhases(t *testing.T) {
	for _, tools := range []bool{false, true} {
		result := ChatGenerationResult{OutputText: "legacy text"}
		want := "final_answer"
		if tools {
			result.ToolCalls = []ProviderToolCall{{ID: "call"}}
			want = "commentary"
		}
		deriveResultPhases(&result)
		if result.TextSegments[0].Phase != want || result.TextSegments[0].PhaseSource != "derived" {
			t.Fatalf("derived=%#v", result)
		}
		if providerPartsFromResult(result)[0].Text != "legacy text" {
			t.Fatal("legacy text changed")
		}
	}
}
