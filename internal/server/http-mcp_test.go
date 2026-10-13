package server

import (
	"context"
	"net/http"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPAuthenticatedAPIsAndSecretReplacement(t *testing.T) {
	app := newTestApp(t, nil)
	cookie := signupAndRequireCookie(t, app, "mcp-api@example.com")
	other := signupAndRequireCookie(t, app, "other-mcp-api@example.com")
	mcpFixture(t, app.app.mcp, "", func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{}, nil
	})
	create := performJSONRequest(t, app.handler, http.MethodPost, "/api/mcp/servers", MCPServerInput{Name: "Remote", Endpoint: "https://mcp.test.invalid/mcp", AuthMode: "bearer", Token: "fixture-secret"}, []*http.Cookie{cookie})
	assertStatusCode(t, create, 200)
	var result struct {
		Server MCPServer `json:"server"`
	}
	decodeResponseJSON(t, create, &result)
	path := "/api/mcp/servers/" + result.Server.ID
	unauthorized := performJSONRequest(t, app.handler, http.MethodGet, path, nil, []*http.Cookie{other})
	assertStatusCode(t, unauthorized, 404)
	test := performJSONRequest(t, app.handler, http.MethodPost, path+"/test", map[string]any{}, []*http.Cookie{cookie})
	assertStatusCode(t, test, 200)
	var discovered struct {
		Tools []MCPTool `json:"tools"`
	}
	decodeResponseJSON(t, test, &discovered)
	enable := performJSONRequest(t, app.handler, http.MethodPatch, path+"/tools/"+discovered.Tools[0].ID, map[string]any{"enabled": true, "approvalPolicy": "always"}, []*http.Cookie{cookie})
	assertStatusCode(t, enable, 200)
	badPolicy := performJSONRequest(t, app.handler, http.MethodPatch, path+"/tools/"+discovered.Tools[0].ID, map[string]any{"enabled": true, "approvalPolicy": "never"}, []*http.Cookie{cookie})
	assertStatusCode(t, badPolicy, 400)
	replacement := performJSONRequest(t, app.handler, http.MethodPatch, path, MCPServerInput{Name: "Renamed", Endpoint: result.Server.Endpoint, AuthMode: "bearer", Token: "replacement-secret"}, []*http.Cookie{cookie})
	assertStatusCode(t, replacement, 200)
	get := performJSONRequest(t, app.handler, http.MethodGet, path, nil, []*http.Cookie{cookie})
	assertStatusCode(t, get, 200)
	decodeResponseJSON(t, get, &result)
	if !result.Server.HasToken || result.Server.Name != "Renamed" {
		t.Fatal("credential replacement lost configuration")
	}
	list := performJSONRequest(t, app.handler, http.MethodGet, "/api/mcp/servers", nil, []*http.Cookie{other})
	assertStatusCode(t, list, 200)
	var empty struct {
		Servers []MCPServer `json:"servers"`
	}
	decodeResponseJSON(t, list, &empty)
	if len(empty.Servers) != 0 {
		t.Fatal("cross-user server listing")
	}
	remove := performJSONRequest(t, app.handler, http.MethodDelete, path, nil, []*http.Cookie{cookie})
	assertStatusCode(t, remove, 200)
	missing := performJSONRequest(t, app.handler, http.MethodGet, path, nil, []*http.Cookie{cookie})
	assertStatusCode(t, missing, 404)
}
