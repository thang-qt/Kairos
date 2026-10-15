package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type mcpRewriteTransport struct {
	base     http.RoundTripper
	endpoint *url.URL
	token    string
}

func (transport mcpRewriteTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	clone := r.Clone(r.Context())
	u := *r.URL
	u.Scheme = transport.endpoint.Scheme
	u.Host = transport.endpoint.Host
	clone.URL = &u
	clone.Host = u.Host
	clone.Header = clone.Header.Clone()
	if transport.token != "" {
		clone.Header.Set("Authorization", "Bearer "+transport.token)
	}
	return transport.base.RoundTrip(clone)
}
func mcpFixture(t *testing.T, service *MCPService, token string, handler func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error)) *httptest.Server {
	t.Helper()
	service.sessionOptions = &mcp.ClientSessionOptions{ProtocolVersion: "2025-11-25"}
	sdk := mcp.NewServer(&mcp.Implementation{Name: "Fixture", Version: "1"}, &mcp.ServerOptions{PageSize: 1, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
	for _, name := range []string{"echo", "other", "third"} {
		sdk.AddTool(&mcp.Tool{Name: name, Description: "Fixture " + token, InputSchema: map[string]any{"type": "object", "properties": map[string]any{"value": map[string]any{"type": "string"}}, "required": []string{"value"}, "additionalProperties": false}, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}, handler)
	}
	handlerHTTP := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return sdk }, &mcp.StreamableHTTPOptions{Stateless: false})
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token != "" && r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, "rejected", 401)
			return
		}
		handlerHTTP.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	endpoint, _ := url.Parse(server.URL)
	service.clientFor = func(c *urlMCPConfig) *http.Client {
		client := *server.Client()
		client.Transport = mcpRewriteTransport{base: client.Transport, endpoint: endpoint, token: c.Token}
		client.Timeout = 5 * time.Second
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("redirect blocked") }
		return &client
	}
	return server
}
func addMCPFixture(t *testing.T, app *testApp, user, token string) (MCPServer, MCPTool) {
	t.Helper()
	mode := "none"
	if token != "" {
		mode = "bearer"
	}
	server, err := app.app.mcp.Save(context.Background(), user, "", MCPServerInput{Name: "Fixture", Endpoint: "https://mcp.test.invalid/mcp", AuthMode: mode, Token: token})
	if err != nil {
		t.Fatal(err)
	}
	tools, err := app.app.mcp.Refresh(context.Background(), user, server.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(tools) != 3 {
		t.Fatalf("pagination tools=%d", len(tools))
	}
	for _, tool := range tools {
		if tool.Enabled || strings.Contains(tool.Description, token) && token != "" {
			t.Fatal("discovery enabled a tool or leaked token")
		}
	}
	tool := tools[0]
	if err := app.app.mcp.SetTool(context.Background(), user, server.ID, tool.ID, true, "always"); err != nil {
		t.Fatal(err)
	}
	return server, tool
}
func waitMCPApproval(t *testing.T, service *MCPService, user string) MCPApproval {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		values, err := service.Approvals(context.Background(), user, "")
		if err != nil {
			t.Fatal(err)
		}
		for _, value := range values {
			if value.State == "pending" {
				return value
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("no pending MCP approval")
	return MCPApproval{}
}
func TestMCPStorageDiscoveryAndOwnership(t *testing.T) {
	app, user, _ := runtimeFixture(t)
	token := "fixture-pat-secret"
	mcpFixture(t, app.app.mcp, token, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{}, nil
	})
	server, tool := addMCPFixture(t, app, user, token)
	var encrypted string
	if err := app.app.db.QueryRow(`SELECT token_encrypted FROM user_mcp_servers WHERE id=?`, server.ID).Scan(&encrypted); err != nil {
		t.Fatal(err)
	}
	if encrypted == token || strings.Contains(encrypted, token) {
		t.Fatal("credential stored plaintext")
	}
	records, err := app.app.mcp.List(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	serialized, _ := json.Marshal(records)
	if strings.Contains(string(serialized), token) || strings.Contains(string(serialized), encrypted) {
		t.Fatal("read API exposed credentials")
	}
	refreshed, err := app.app.mcp.Refresh(context.Background(), user, server.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !refreshed[0].Enabled || refreshed[0].ID != tool.ID || refreshed[0].Alias != tool.Alias {
		t.Fatal("refresh lost tool identity/permission")
	}
	if _, _, err := app.app.mcp.get(context.Background(), "another-user", server.ID); !errors.Is(err, errMCPNotFound) {
		t.Fatal("cross-user server access")
	}
	if err := app.app.mcp.SetTool(context.Background(), "another-user", server.ID, tool.ID, true, "always"); !errors.Is(err, errMCPNotFound) {
		t.Fatal("cross-user tool change")
	}
	if err := app.app.mcp.Delete(context.Background(), "another-user", server.ID); !errors.Is(err, errMCPNotFound) {
		t.Fatal("cross-user deletion")
	}
	second, err := app.app.mcp.Save(context.Background(), user, "", MCPServerInput{Name: "Second", Endpoint: server.Endpoint, AuthMode: "bearer", Token: token})
	if err != nil {
		t.Fatal(err)
	}
	other, err := app.app.mcp.Refresh(context.Background(), user, second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if other[0].Alias == tool.Alias {
		t.Fatal("duplicate names across servers collided")
	}
	if err := app.app.mcp.SetTool(context.Background(), user, server.ID, tool.ID, true, "read-only"); err == nil {
		t.Fatal("trusted read-only hint instead of requiring approval")
	}
}
func TestMCPToolApprovalRunsInsideOneAssistantTurn(t *testing.T) {
	app, user, session := runtimeFixture(t)
	var executed atomic.Int32
	mcpFixture(t, app.app.mcp, "fixture-pat-secret", func(ctx context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		executed.Add(1)
		_ = request.Session.NotifyProgress(ctx, &mcp.ProgressNotificationParams{ProgressToken: request.Params.GetProgressToken(), Progress: 1, Total: 1, Message: "done fixture-pat-secret"})
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "remote result fixture-pat-secret"}}}, nil
	})
	_, tool := addMCPFixture(t, app, user, "fixture-pat-secret")
	app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, n int, request ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
		if n == 1 {
			found := false
			for _, definition := range request.Tools {
				if definition.Name == tool.Alias {
					found = true
				}
			}
			if !found {
				t.Error("registry did not expose enabled MCP tool")
			}
			return ChatGenerationResult{ToolCalls: []ProviderToolCall{{ID: "remote-call", Name: tool.Alias, ArgsJSON: `{"value":"input"}`}}}, nil
		}
		return ChatGenerationResult{OutputText: "final answer"}, nil
	}}
	run := startRuntimeTurn(t, app, user, session, "remote")
	approval := waitMCPApproval(t, app.app.mcp, user)
	if executed.Load() != 0 {
		t.Fatal("tool executed without approval")
	}
	if err := app.app.mcp.Decide(context.Background(), "other-user", approval.ID, "approved"); err == nil {
		t.Fatal("cross-user approval allowed")
	}
	if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "approved"); err != nil {
		t.Fatal(err)
	}
	waitForRunStatus(t, app, run.RunID, "completed")
	history := requireTwoTurns(t, app, user, session, run.AssistantTurnID, "completed")
	encoded, _ := json.Marshal(history)
	if strings.Contains(string(encoded), "fixture-pat-secret") {
		t.Fatal("tool result/events leaked token")
	}
	steps := history.Messages[1]["steps"].([]any)
	if len(steps) != 3 || executed.Load() != 1 {
		t.Fatalf("steps=%d calls=%d", len(steps), executed.Load())
	}
	if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "approved"); err == nil {
		t.Fatal("consumed approval reused")
	}
	var progress string
	_ = app.app.db.QueryRow(`SELECT progress_json FROM mcp_approvals WHERE id=?`, approval.ID).Scan(&progress)
	if strings.Contains(progress, "fixture-pat-secret") {
		t.Fatal("progress leaked token")
	}
}
func TestMCPPendingApprovalRevokedByDisableAndCancellation(t *testing.T) {
	for _, mode := range []string{"disable", "delete", "cancel", "deny", "expire"} {
		t.Run(mode, func(t *testing.T) {
			app, user, session := runtimeFixture(t)
			var executed atomic.Int32
			mcpFixture(t, app.app.mcp, "", func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				executed.Add(1)
				return &mcp.CallToolResult{}, nil
			})
			server, tool := addMCPFixture(t, app, user, "")
			app.app.providers.drivers[openAIProviderKind] = &runtimeTestDriver{generate: func(_ context.Context, n int, _ ChatGenerationRequest, _ func(ChatGenerationDelta) error) (ChatGenerationResult, error) {
				if n == 1 {
					return ChatGenerationResult{ToolCalls: []ProviderToolCall{{ID: "call", Name: tool.Alias, ArgsJSON: `{"value":"input"}`}}}, nil
				}
				return ChatGenerationResult{OutputText: "denied"}, nil
			}}
			run := startRuntimeTurn(t, app, user, session, "pending")
			approval := waitMCPApproval(t, app.app.mcp, user)
			switch mode {
			case "disable":
				disabled := false
				_, err := app.app.mcp.Save(context.Background(), user, server.ID, MCPServerInput{Name: server.Name, Endpoint: server.Endpoint, AuthMode: "none", Enabled: &disabled})
				if err != nil {
					t.Fatal(err)
				}
			case "delete":
				if err := app.app.mcp.Delete(context.Background(), user, server.ID); err != nil {
					t.Fatal(err)
				}
			case "cancel":
				_, _ = app.app.runtime.CancelRun(context.Background(), user, session.FriendlyID, run.RunID)
			case "deny":
				if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "denied"); err != nil {
					t.Fatal(err)
				}
			case "expire":
				if _, err := app.app.db.Exec(`UPDATE mcp_approvals SET expires_at=0 WHERE id=?`, approval.ID); err != nil {
					t.Fatal(err)
				}
				values, err := app.app.mcp.Approvals(context.Background(), user, session.FriendlyID)
				if err != nil {
					t.Fatal(err)
				}
				for _, value := range values {
					if value.ID == approval.ID {
						t.Fatal("expired approval remained visible")
					}
				}
				var state string
				if err := app.app.db.QueryRow(`SELECT state FROM mcp_approvals WHERE id=?`, approval.ID).Scan(&state); err != nil {
					t.Fatal(err)
				}
				if state != "pending" {
					t.Fatalf("approval state after read = %q, want pending", state)
				}
				_, _ = app.app.runtime.CancelRun(context.Background(), user, session.FriendlyID, run.RunID)
			}
			if mode == "cancel" || mode == "expire" {
				waitForRunStatus(t, app, run.RunID, "aborted")
			} else if mode == "deny" {
				waitForRunStatus(t, app, run.RunID, "completed")
			} else {
				waitForRunStatus(t, app, run.RunID, "error")
			}
			if executed.Load() != 0 {
				t.Fatal("revoked tool executed")
			}
			if err := app.app.mcp.Decide(context.Background(), user, approval.ID, "approved"); err == nil {
				t.Fatal("revoked approval accepted")
			}
		})
	}
}
func TestMCPEndpointAndDNSProtection(t *testing.T) {
	for _, endpoint := range []string{"http://example.com/mcp", "https://localhost/mcp", "https://127.0.0.1/mcp", "https://[::1]/mcp", "https://169.254.169.254/mcp", "https://10.0.0.1/mcp", "https://user:secret@example.com/mcp", "https://example.com/mcp?token=secret"} {
		if _, err := validateMCPEndpoint(endpoint); err == nil {
			t.Fatalf("accepted %s", endpoint)
		}
	}
	for _, ip := range []string{"127.0.0.1", "::1", "::ffff:127.0.0.1", "10.1.1.1", "169.254.169.254", "100.100.100.200", "fc00::1", "fe80::1", "0.0.0.0", "2002:7f00:1::"} {
		if publicMCPAddress(netip.MustParseAddr(ip)) {
			t.Fatalf("accepted IP %s", ip)
		}
	}
	endpoint, _ := url.Parse("https://public.example/mcp")
	var calls, dns atomic.Int32
	transport := &mcpSafeTransport{endpoint: endpoint, token: "secret", resolve: func(context.Context, string) ([]netip.Addr, error) {
		if dns.Add(1) == 1 {
			return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
		}
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	}, roundTrip: func(request *http.Request, httpTransport *http.Transport) (*http.Response, error) {
		calls.Add(1)
		if request.URL.Host != "8.8.8.8:443" || request.Host != "public.example" || httpTransport.TLSClientConfig.ServerName != "public.example" {
			t.Error("validated address was not pinned with original TLS identity")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("ok"))}, nil
	}}
	request, _ := http.NewRequest(http.MethodPost, endpoint.String(), nil)
	response, err := transport.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if _, err := transport.RoundTrip(request); err == nil || calls.Load() != 1 {
		t.Fatal("DNS rebinding reached transport")
	}
	foreign, _ := http.NewRequest(http.MethodGet, "https://other.example/mcp", nil)
	if _, err := transport.RoundTrip(foreign); err == nil {
		t.Fatal("cross-origin credential request allowed")
	}
}
func TestMCPResultAndSchemaLimits(t *testing.T) {
	if validateMCPSchema(map[string]any{"$ref": "https://169.254.169.254/schema"}, 0) {
		t.Fatal("external schema reference allowed")
	}
	body := &mcpLimitedBody{ReadCloser: io.NopCloser(strings.NewReader(strings.Repeat("x", 20))), remaining: 10, cleanup: func() {}}
	if _, err := io.ReadAll(body); err == nil {
		t.Fatal("oversized response accepted")
	}
	body.Close()
	app, _, _ := runtimeFixture(t)
	production := NewMCPService(app.app.db, Config{AppEnv: "production"})
	defer production.Close()
	if production.secureStorage {
		t.Fatal("production accepted unset encryption key")
	}
}

func TestMCPCredentialsCannotFollowOriginChanges(t *testing.T) {
	app, user, _ := runtimeFixture(t)
	server, err := app.app.mcp.Save(context.Background(), user, "", MCPServerInput{Name: "GitHub", Endpoint: "https://api.githubcopilot.com/mcp/readonly", AuthMode: "bearer", Token: "fixture-pat-secret"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = app.app.mcp.Save(context.Background(), user, server.ID, MCPServerInput{Name: "Changed", Endpoint: "https://other.example/mcp", AuthMode: "bearer"})
	if err == nil {
		t.Fatal("stored credential silently forwarded to another origin")
	}
	current, _, err := app.app.mcp.get(context.Background(), user, server.ID)
	if err != nil || current.Endpoint != server.Endpoint {
		t.Fatal("failed origin change mutated configuration")
	}
	_, err = app.app.mcp.Save(context.Background(), user, server.ID, MCPServerInput{Name: "Changed", Endpoint: "https://other.example/mcp", AuthMode: "bearer", Token: "explicit-new-token"})
	if err != nil {
		t.Fatal(err)
	}
}

func TestMCPRedirectNeverForwardsCredentials(t *testing.T) {
	endpoint, _ := url.Parse("https://public.example/mcp")
	var calls atomic.Int32
	transport := &mcpSafeTransport{endpoint: endpoint, token: "fixture-secret", resolve: func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
	}, roundTrip: func(request *http.Request, _ *http.Transport) (*http.Response, error) {
		calls.Add(1)
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://169.254.169.254/mcp"}}, Body: io.NopCloser(strings.NewReader("redirect")), Request: request}, nil
	}}
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("MCP redirects are blocked") }}
	request, _ := http.NewRequest(http.MethodPost, endpoint.String(), nil)
	response, err := client.Do(request)
	if response != nil {
		response.Body.Close()
	}
	if err == nil || calls.Load() != 1 {
		t.Fatal("redirect followed or credentials forwarded")
	}
}

func TestMCPBadCredentialsAndMalformedDiscoveryAreSafe(t *testing.T) {
	app, user, _ := runtimeFixture(t)
	mcpFixture(t, app.app.mcp, "expected-secret", func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{}, nil
	})
	server, err := app.app.mcp.Save(context.Background(), user, "", MCPServerInput{Name: "Bad auth", Endpoint: "https://mcp.test.invalid/mcp", AuthMode: "bearer", Token: "incorrect-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.app.mcp.Refresh(context.Background(), user, server.ID); err == nil || strings.Contains(err.Error(), "incorrect-secret") {
		t.Fatal("bad credentials accepted or reflected")
	}
	current, _, err := app.app.mcp.get(context.Background(), user, server.ID)
	if err != nil || current.Health != "error" || strings.Contains(current.LastError, "incorrect-secret") {
		t.Fatal("unsafe connection health")
	}
	for _, schema := range []any{nil, 42, map[string]any{"type": "string"}, map[string]any{"type": "object", "$ref": "https://private.example/schema"}} {
		if object, ok := schema.(map[string]any); ok && object["type"] == "object" && validateMCPSchema(schema, 0) {
			t.Fatal("external schema passed validation")
		}
	}
}
