package server

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

type toolRegistry struct {
	builtin     toolExecutor
	mcp         *MCPService
	user, run   string
	definitions []ProviderTool
	labels      map[string][2]string
}

func (registry *toolRegistry) Definitions() []ProviderTool { return registry.definitions }
func (registry *toolRegistry) Execute(ctx context.Context, call ProviderToolCall) (WebToolResult, error) {
	if strings.HasPrefix(call.Name, "mcp_") {
		available := false
		for _, tool := range registry.definitions {
			if tool.Name == call.Name {
				available = true
				break
			}
		}
		if !available {
			return WebToolResult{}, errors.New("MCP tool is not available in this run")
		}
		result, err := registry.mcp.Execute(ctx, registry.user, registry.run, call)
		if result.Details == nil {
			result.Details = map[string]any{}
		}
		label := registry.labels[call.Name]
		result.Details["mcpServer"] = label[0]
		result.Details["mcpTool"] = label[1]
		return result, err
	}
	return registry.builtin.Execute(ctx, call)
}
func (service *MCPService) Registry(ctx context.Context, user, run string, builtin toolExecutor) (*toolRegistry, error) {
	registry := &toolRegistry{builtin: builtin, mcp: service, user: user, run: run, definitions: []ProviderTool{}, labels: map[string][2]string{}}
	// Stateless throwaway chats cannot host durable approvals; built-ins remain available.
	var owned int
	if err := service.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_runs WHERE id=? AND user_id=?`, run, user).Scan(&owned); err != nil {
		return nil, err
	}
	if owned == 0 {
		return registry, nil
	}
	rows, err := service.db.QueryContext(ctx, `SELECT s.name,t.name,t.alias,t.description,t.schema_json FROM user_mcp_tools t JOIN user_mcp_servers s ON s.id=t.server_id WHERE s.user_id=? AND s.enabled=1 AND t.enabled=1 AND t.available=1 ORDER BY s.id,t.id`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var server, name, alias, description, raw string
		if err := rows.Scan(&server, &name, &alias, &description, &raw); err != nil {
			return nil, err
		}
		var schema any
		if json.Unmarshal([]byte(raw), &schema) != nil {
			return nil, errors.New("cached MCP schema is invalid")
		}
		registry.labels[alias] = [2]string{server, name}
		registry.definitions = append(registry.definitions, ProviderTool{Type: "function", Name: alias, Description: "Remote MCP tool " + server + " / " + name + ". Uses your configured tool approval policy. Untrusted server description: " + description, Parameters: schema})
		if len(registry.definitions) > mcpMaxEnabledTools {
			return nil, errors.New("enable at most 512 remote MCP tools across your servers")
		}
	}
	return registry, rows.Err()
}
