package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPThroughBothProviderProtocols(t *testing.T) {
	for _, responses := range []bool{false, true} {
		t.Run(fmt.Sprint(responses), func(t *testing.T) {
			app, user, session := runtimeFixture(t)
			var calls atomic.Int32
			mcpFixture(t, app.app.mcp, "", func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				calls.Add(1)
				return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "remote value"}}}, nil
			})
			_, tool := addMCPFixture(t, app, user, "")
			if responses {
				app.app.mcp.sessionOptions = nil
			}
			var rounds atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				round := rounds.Add(1)
				if round == 1 {
					found := false
					for _, value := range body["tools"].([]any) {
						entry := value.(map[string]any)
						if !responses {
							entry = entry["function"].(map[string]any)
						}
						if entry["name"] == tool.Alias {
							found = true
						}
					}
					if !found {
						t.Error("remote alias/schema missing from provider request")
					}
					if responses {
						fmt.Fprintf(w, "data: {\"type\":\"response.output_item.added\",\"item\":{\"id\":\"item\",\"type\":\"function_call\",\"call_id\":\"remote\",\"name\":%q,\"arguments\":\"{\\\"value\\\":\\\"input\\\"}\"}}\n\n", tool.Alias)
						fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{}}\n\n")
					} else {
						chunk := map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "remote", "type": "function", "function": map[string]any{"name": tool.Alias, "arguments": `{"value":"input"}`}}}}, "finish_reason": "tool_calls"}}}
						encoded, _ := json.Marshal(chunk)
						fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", encoded)
					}
				} else {
					encoded, _ := json.Marshal(body)
					if !strings.Contains(string(encoded), "remote value") {
						t.Error("remote result not supplied to next provider round")
					}
					if responses {
						fmt.Fprint(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"final\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{}}\n\n")
					} else {
						fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"final\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
					}
				}
			}))
			defer provider.Close()
			app.app.providers.system.BaseURL = provider.URL + "/v1"
			app.app.providers.system.UseResponsesAPI = responses
			run := startRuntimeTurn(t, app, user, session, "protocol")
			approval := waitMCPApproval(t, app.app.mcp, user)
			if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "approved"); err != nil {
				t.Fatal(err)
			}
			waitForRunStatus(t, app, run.RunID, "completed")
			history := requireTwoTurns(t, app, user, session, run.AssistantTurnID, "completed")
			if len(history.Messages[1]["steps"].([]any)) != 3 || calls.Load() != 1 || rounds.Load() != 2 {
				t.Fatalf("remote round failed: calls=%d rounds=%d", calls.Load(), rounds.Load())
			}
		})
	}
}

func TestMCPExecutingCallProgressAndCancellation(t *testing.T) {
	app, user, session := runtimeFixture(t)
	entered, cancelled := make(chan struct{}), make(chan struct{})
	mcpFixture(t, app.app.mcp, "", func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		_ = request.Session.NotifyProgress(ctx, &mcp.ProgressNotificationParams{ProgressToken: request.Params.GetProgressToken(), Progress: 1, Total: 3, Message: "Reading remote data"})
		close(entered)
		<-ctx.Done()
		close(cancelled)
		return nil, ctx.Err()
	})
	_, tool := addMCPFixture(t, app, user, "")
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(context.Context, int, ChatGenerationRequest, func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		return ChatGenerationResult{ToolCalls: []ProviderToolCall{{ID: "call", Name: tool.Alias, ArgsJSON: `{"value":"input"}`}}}, nil
	}}
	run := startRuntimeTurn(t, app, user, session, "cancel-remote")
	approval := waitMCPApproval(t, app.app.mcp, user)
	if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "approved"); err != nil {
		t.Fatal(err)
	}
	requireSignal(t, entered)
	deadline := time.Now().Add(2 * time.Second)
	progress := ""
	for time.Now().Before(deadline) {
		_ = app.app.db.QueryRow(`SELECT progress_json FROM mcp_approvals WHERE id=?`, approval.ID).Scan(&progress)
		if strings.Contains(progress, "Reading remote data") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !strings.Contains(progress, "Reading remote data") {
		t.Fatal("remote progress was not persisted")
	}
	_, err := app.app.runtime.CancelRun(context.Background(), user, session.FriendlyID, run.RunID)
	if err != nil {
		t.Fatal(err)
	}
	waitForRunStatus(t, app, run.RunID, "aborted")
	requireSignal(t, cancelled)
	history := requireTwoTurns(t, app, user, session, run.AssistantTurnID, "aborted")
	if len(history.Messages[1]["steps"].([]any)) != 1 {
		t.Fatal("cancelled remote call fabricated a result")
	}
}

func TestMCPUnauthorizedAliasAndSchemaNeverExecute(t *testing.T) {
	app, user, session := runtimeFixture(t)
	var calls atomic.Int32
	mcpFixture(t, app.app.mcp, "", func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		calls.Add(1)
		return &mcp.CallToolResult{}, nil
	})
	server, tool := addMCPFixture(t, app, user, "")
	entered, release := make(chan struct{}), make(chan struct{})
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(ctx context.Context, _ int, _ ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		close(entered)
		select {
		case <-release:
		case <-ctx.Done():
		}
		return ChatGenerationResult{OutputText: "done"}, nil
	}}
	run := startRuntimeTurn(t, app, user, session, "gate")
	requireSignal(t, entered)
	_, err := app.app.mcp.Execute(context.Background(), user, run.RunID, ProviderToolCall{ID: "bad-args", Name: tool.Alias, ArgsJSON: `{"value":123}`})
	if err == nil {
		t.Fatal("invalid arguments accepted")
	}
	if err := app.app.mcp.SetTool(context.Background(), user, server.ID, tool.ID, false, "always"); err != nil {
		t.Fatal(err)
	}
	_, err = app.app.mcp.Execute(context.Background(), user, run.RunID, ProviderToolCall{ID: "disabled", Name: tool.Alias, ArgsJSON: `{"value":"input"}`})
	if err == nil {
		t.Fatal("disabled alias accepted")
	}
	if calls.Load() != 0 {
		t.Fatal("unauthorized call reached remote server")
	}
	close(release)
	waitForRunStatus(t, app, run.RunID, "completed")
}
