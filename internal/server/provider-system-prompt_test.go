package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSystemPromptReachesBothProviderProtocols(t *testing.T) {
	for _, responses := range []bool{false, true} {
		for _, custom := range []string{"", "Be concise."} {
			t.Run(fmt.Sprintf("responses=%v/custom=%v", responses, custom != ""), func(t *testing.T) {
				prompt := buildEffectiveSystemPrompt(custom, "Test Model", time.Date(2026, 7, 13, 14, 32, 5, 0, time.UTC), "", "")
				want := "You are an AI assistant in Kairos, a lightweight AI chat client.\n\n"
				if custom != "" {
					want += custom + "\n\n"
				}
				want += "Runtime context:\n- Current time: 2026-07-13 14:32:05 UTC (server fallback).\n- Current model: Test Model."
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var body struct {
						Instructions string `json:"instructions"`
						Messages     []struct {
							Role    string `json:"role"`
							Content any    `json:"content"`
						} `json:"messages"`
					}
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					if responses {
						if body.Instructions != want {
							t.Errorf("instructions = %q, want %q", body.Instructions, want)
						}
						fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{}}\n\n")
					} else {
						if len(body.Messages) == 0 || body.Messages[0].Role != "system" || body.Messages[0].Content != want {
							t.Errorf("system message missing or changed: %+v", body.Messages)
						}
						fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
					}
				}))
				defer server.Close()
				driver := &OpenAICompatibleDriver{httpClient: server.Client()}
				messages := buildProviderMessages(nil, prompt)
				messages = append(messages, ProviderMessage{Role: "user", Parts: []ProviderMessagePart{{Type: "text", Text: "Hello"}}})
				_, err := driver.GenerateChatStream(context.Background(), resolvedProvider{BaseURL: server.URL, Record: ProviderRecord{Kind: openAIProviderKind, UseResponsesAPI: responses}}, ChatGenerationRequest{Model: "test", SystemPrompt: prompt, Messages: messages}, func(ChatGenerationDelta) error { return nil })
				if err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}
