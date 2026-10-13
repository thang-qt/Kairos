package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProviderReasoningEffortsReachBothProtocols(t *testing.T) {
	for _, responses := range []bool{false, true} {
		for _, effort := range []string{"none", "minimal", "low", "medium", "high", "xhigh", "max"} {
			t.Run(fmt.Sprintf("responses=%v/%s", responses, effort), func(t *testing.T) {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Fatal(err)
					}
					w.Header().Set("Content-Type", "text/event-stream")
					if responses {
						if r.URL.Path != "/responses" || body["reasoning"].(map[string]any)["effort"] != effort {
							t.Errorf("reasoning not sent: %v", body)
						}
						fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{}}\n\n")
					} else {
						if r.URL.Path != "/chat/completions" || body["reasoning_effort"] != effort {
							t.Errorf("reasoning not sent: %v", body)
						}
						fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
					}
				}))
				defer server.Close()
				driver := &OpenAICompatibleDriver{httpClient: server.Client()}
				_, err := driver.GenerateChatStream(context.Background(), resolvedProvider{BaseURL: server.URL, Record: ProviderRecord{Kind: openAIProviderKind, UseResponsesAPI: responses}}, ChatGenerationRequest{Model: "test", Advanced: &ChatAdvancedOptions{Reasoning: &ChatReasoningOptions{Effort: effort}}}, func(ChatGenerationDelta) error { return nil })
				if err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestProviderReasoningValidatesEndpointSpecificLevels(t *testing.T) {
	metadata := &ModelCatalogMetadata{Match: "provider", Model: json.RawMessage(`{"reasoning":true,"reasoning_options":[{"type":"effort","values":["low","high","xhigh"]}]}`)}
	model := ProviderModel{ID: "deepseek", CatalogMetadata: metadata}
	for _, effort := range []string{"low", "high", "xhigh"} {
		if err := validateReasoningOptions(model, &ChatAdvancedOptions{Reasoning: &ChatReasoningOptions{Effort: effort}}); err != nil {
			t.Fatal(err)
		}
	}
	if err := validateReasoningOptions(model, &ChatAdvancedOptions{Reasoning: &ChatReasoningOptions{Effort: "medium"}}); err == nil {
		t.Fatal("silently accepted unsupported level")
	}
	if err := validateReasoningOptions(model, nil); err != nil {
		t.Fatal("rejected provider default")
	}
}

func TestProviderResponsesToggleKeepsProviderIdentityAndSecret(t *testing.T) {
	app, user, _ := runtimeFixture(t)
	provider, err := app.app.providers.CreateProvider(context.Background(), user, CreateProviderInput{Kind: openAIProviderKind, Label: "Existing", APIKey: "fixture", BaseURL: "https://hyper.charm.land/v1"})
	if err != nil {
		t.Fatal(err)
	}
	app.app.providers.drivers[openAIProviderKind] = &countingProviderDriver{models: []ProviderModel{{ID: "test-model"}}}
	_, err = app.app.providers.AddCustomModel(context.Background(), user, CreateModelInput{ProviderRef: provider.Ref, ModelID: "custom", Name: "My custom"})
	if err != nil {
		t.Fatal(err)
	}
	enabled := true
	updated, err := app.app.providers.UpdateProvider(context.Background(), user, provider.ID, UpdateProviderInput{UseResponsesAPI: &enabled})
	if err != nil {
		t.Fatal(err)
	}
	if updated.ID != provider.ID || updated.Kind != openAIProviderKind || !updated.UseResponsesAPI {
		t.Fatalf("changed provider identity: %#v", updated)
	}
	resolved, err := app.app.providers.resolveProvider(context.Background(), user, provider.Ref)
	if err != nil || resolved.APIKey != "fixture" || !resolved.Record.UseResponsesAPI {
		t.Fatalf("toggle lost credentials: %#v %v", resolved.Record, err)
	}
	var customCount int
	if err := app.app.db.QueryRow(`SELECT COUNT(*) FROM provider_models WHERE provider_ref=? AND model_id='custom' AND is_custom=1`, provider.Ref).Scan(&customCount); err != nil || customCount != 1 {
		t.Fatal("toggle removed custom model configuration")
	}
	enabled = false
	updated, err = app.app.providers.UpdateProvider(context.Background(), user, provider.ID, UpdateProviderInput{UseResponsesAPI: &enabled})
	if err != nil || updated.UseResponsesAPI {
		t.Fatal("failed to switch back to Chat Completions")
	}
}
