package server

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPNewSessionsLoadParameterHeaderSchemas(t *testing.T) {
	for _, protocol := range []string{"2025-11-25", "2026-07-28"} {
		t.Run(protocol, func(t *testing.T) {
			sdk := mcp.NewServer(&mcp.Implementation{Name: "Header fixture", Version: "1"}, &mcp.ServerOptions{PageSize: 1, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
			for _, name := range []string{"first", "get_file_contents"} {
				sdk.AddTool(&mcp.Tool{Name: name, InputSchema: map[string]any{
					"type":       "object",
					"properties": map[string]any{"value": map[string]any{"type": "string", "x-mcp-header": "Value"}},
					"required":   []string{"value"},
				}}, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
					return &mcp.CallToolResult{Content: []mcp.Content{&mcp.EmbeddedResource{Resource: &mcp.ResourceContents{URI: "repo://fixture/file", Text: "file contents"}}}}, nil
				})
			}
			handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return sdk }, &mcp.StreamableHTTPOptions{Stateless: true})
			remote := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Mcp-Protocol-Version") >= "2026-07-28" && r.Header.Get("Mcp-Method") == "tools/call" && r.Header.Get("Mcp-Param-Value") != "file" {
					t.Error("tool call omitted its schema-defined parameter header")
					http.Error(w, "missing parameter header", http.StatusBadRequest)
					return
				}
				handler.ServeHTTP(w, r)
			}))
			defer remote.Close()
			endpoint, _ := url.Parse(remote.URL)
			service := &MCPService{sessionOptions: &mcp.ClientSessionOptions{ProtocolVersion: protocol}}
			service.clientFor = func(*urlMCPConfig) *http.Client {
				client := *remote.Client()
				client.Transport = mcpRewriteTransport{base: client.Transport, endpoint: endpoint}
				return &client
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			// A new session must work without a user-triggered discovery, including
			// after an idle session is replaced. The target tool is on the second page.
			for range 2 {
				session, err := service.connect(ctx, MCPServer{Endpoint: "https://mcp.test.invalid/mcp"}, "")
				if err != nil {
					t.Fatal(err)
				}
				result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "get_file_contents", Arguments: map[string]any{"value": "file"}})
				_ = session.Close()
				if err != nil {
					t.Fatalf("file read on new session: %v", err)
				}
				if result.IsError || len(result.Content) != 1 {
					t.Fatal("file result was not returned")
				}
				resource, ok := result.Content[0].(*mcp.EmbeddedResource)
				if !ok || resource.Resource.Text != "file contents" {
					t.Fatal("embedded file contents were lost")
				}
			}
		})
	}
}
