package server

import (
	"errors"
	"net/http"
)

func (app *App) handleMCP(writer http.ResponseWriter, request *http.Request) {
	user, ok := app.requireAuthenticatedUser(writer, request)
	if !ok {
		return
	}
	id := request.PathValue("id")
	toolID := request.PathValue("toolId")
	action := request.PathValue("action")
	if action != "" {
		allowed := (action == "tools" && request.Method == http.MethodGet) || ((action == "test" || action == "refresh-tools") && request.Method == http.MethodPost)
		if !allowed {
			writeError(writer, http.StatusNotFound, "MCP operation not found")
			return
		}
	}
	var response any
	var err error
	switch {
	case request.URL.Path == "/api/mcp/approvals" && request.Method == http.MethodGet:
		var values []MCPApproval
		values, err = app.mcp.Approvals(request.Context(), user.ID, request.URL.Query().Get("conversation"))
		response = map[string]any{"approvals": values}
	case request.PathValue("approvalId") != "":
		var input struct {
			Decision string `json:"decision"`
		}
		if err = decodeJSON(request, &input); err == nil {
			err = app.mcp.Decide(request.Context(), user.ID, request.PathValue("approvalId"), input.Decision)
		}
		response = map[string]bool{"ok": true}
	case toolID != "":
		var input struct {
			Enabled        *bool  `json:"enabled"`
			ApprovalPolicy string `json:"approvalPolicy"`
		}
		if err = decodeJSON(request, &input); err == nil {
			if input.Enabled == nil {
				err = errors.New("enabled is required")
			} else {
				if input.ApprovalPolicy == "" {
					input.ApprovalPolicy = "always"
				}
				err = app.mcp.SetTool(request.Context(), user.ID, id, toolID, *input.Enabled, input.ApprovalPolicy)
			}
		}
		response = map[string]bool{"ok": true}
	case action == "test" || action == "refresh-tools":
		var tools []MCPTool
		tools, err = app.mcp.Refresh(request.Context(), user.ID, id)
		response = map[string]any{"tools": tools}
	case action == "tools":
		var tools []MCPTool
		tools, err = app.mcp.Tools(request.Context(), user.ID, id)
		response = map[string]any{"tools": tools}
	case request.Method == http.MethodGet && id == "":
		var servers []MCPServer
		servers, err = app.mcp.List(request.Context(), user.ID)
		response = map[string]any{"servers": servers}
	case request.Method == http.MethodGet:
		var server MCPServer
		server, _, err = app.mcp.get(request.Context(), user.ID, id)
		response = map[string]any{"server": server}
	case request.Method == http.MethodDelete:
		err = app.mcp.Delete(request.Context(), user.ID, id)
		response = map[string]bool{"ok": true}
	default:
		var input MCPServerInput
		var server MCPServer
		if err = decodeJSON(request, &input); err == nil {
			server, err = app.mcp.Save(request.Context(), user.ID, id, input)
		}
		response = map[string]any{"server": server}
	}
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errMCPNotFound) {
			status = http.StatusNotFound
		}
		writeError(writer, status, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, response)
}
