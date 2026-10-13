package server

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type MCPApproval struct {
	ID         string          `json:"id"`
	RunID      string          `json:"runId"`
	ServerID   string          `json:"serverId"`
	ServerName string          `json:"serverName"`
	ToolName   string          `json:"toolName"`
	Arguments  json.RawMessage `json:"arguments"`
	State      string          `json:"state"`
	ExpiresAt  int64           `json:"expiresAt"`
	Progress   json.RawMessage `json:"progress"`
}

func (service *MCPService) Approvals(ctx context.Context, user, friendly string) ([]MCPApproval, error) {
	_, err := service.db.ExecContext(ctx, `UPDATE mcp_approvals SET state='cancelled' WHERE user_id=? AND state IN ('pending','approved','executing') AND NOT EXISTS(SELECT 1 FROM chat_runs r JOIN chat_sessions s ON s.id=r.session_id WHERE r.id=mcp_approvals.run_id AND r.status='running' AND r.invalidated=0 AND r.lease_token=mcp_approvals.lease_token AND r.lease_until>? AND r.revision=s.revision)`, user, time.Now().UnixMilli())
	if err != nil {
		return nil, err
	}
	_, err = service.db.ExecContext(ctx, `UPDATE mcp_approvals SET state='expired' WHERE user_id=? AND state IN ('pending','approved') AND expires_at<?`, user, time.Now().UnixMilli())
	if err != nil {
		return nil, err
	}
	rows, err := service.db.QueryContext(ctx, `SELECT a.id,a.run_id,a.server_id,a.server_name,a.tool_name,a.arguments_json,a.state,a.expires_at,a.progress_json FROM mcp_approvals a JOIN chat_runs r ON r.id=a.run_id JOIN chat_sessions s ON s.id=r.session_id WHERE a.user_id=? AND a.state IN ('pending','approved','executing') AND (?='' OR s.friendly_id=?) ORDER BY a.created_at`, user, friendly, friendly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MCPApproval{}
	for rows.Next() {
		var a MCPApproval
		var args, progress string
		if err := rows.Scan(&a.ID, &a.RunID, &a.ServerID, &a.ServerName, &a.ToolName, &args, &a.State, &a.ExpiresAt, &progress); err != nil {
			return nil, err
		}
		a.Arguments = json.RawMessage(args)
		a.Progress = json.RawMessage(progress)
		out = append(out, a)
	}
	return out, rows.Err()
}
func (service *MCPService) Decide(ctx context.Context, user, id, decision string, scopes ...string) error {
	if decision != "approved" && decision != "denied" {
		return errors.New("decision must be approved or denied")
	}
	scope := "once"
	if len(scopes) > 0 && scopes[0] != "" {
		scope = scopes[0]
	}
	if err := validateMCPScope(decision, scope); err != nil {
		return err
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE mcp_approvals SET state=? WHERE id=? AND user_id=? AND state='pending' AND expires_at>? AND EXISTS(SELECT 1 FROM chat_runs r JOIN chat_sessions s ON s.id=r.session_id WHERE r.id=mcp_approvals.run_id AND r.user_id=? AND r.status='running' AND r.invalidated=0 AND r.lease_token=mcp_approvals.lease_token AND r.lease_until>? AND r.revision=s.revision) AND EXISTS(SELECT 1 FROM user_mcp_servers m JOIN user_mcp_tools t ON t.server_id=m.id WHERE m.id=mcp_approvals.server_id AND m.user_id=? AND m.enabled=1 AND m.revision=mcp_approvals.server_revision AND t.id=mcp_approvals.tool_id AND t.enabled=1 AND t.available=1 AND t.schema_json=mcp_approvals.tool_schema)`, decision, id, user, time.Now().UnixMilli(), user, time.Now().UnixMilli(), user)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return errors.New("approval is unavailable, expired or no longer matches this execution")
	}
	if scope != "once" {
		var server, tool, schema, session string
		var revision int64
		err = tx.QueryRowContext(ctx, `SELECT a.server_id,a.tool_id,a.tool_schema,a.server_revision,r.session_id FROM mcp_approvals a JOIN chat_runs r ON r.id=a.run_id WHERE a.id=? AND a.user_id=?`, id, user).Scan(&server, &tool, &schema, &revision, &session)
		if err != nil {
			return err
		}
		var target any
		if scope == "chat" {
			target = session
		}
		if err = writeMCPGrant(ctx, tx, user, server, tool, target, revision, schema); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (service *MCPService) checkCall(ctx context.Context, user, run, alias string) (MCPServer, MCPTool, string, string, error) {
	var t MCPTool
	var serverID, rawSchema string
	err := service.db.QueryRowContext(ctx, `SELECT t.id,t.server_id,t.name,t.alias,t.schema_json FROM user_mcp_tools t JOIN user_mcp_servers s ON s.id=t.server_id WHERE s.user_id=? AND t.alias=? AND s.enabled=1 AND t.enabled=1 AND t.available=1 AND t.approval_policy='always'`, user, alias).Scan(&t.ID, &serverID, &t.Name, &t.Alias, &rawSchema)
	if err != nil {
		return MCPServer{}, t, "", "", errors.New("MCP tool is disabled or unavailable")
	}
	s, encrypted, err := service.get(ctx, user, serverID)
	if err != nil {
		return s, t, "", "", err
	}
	t.ServerID = serverID
	t.Schema = json.RawMessage(rawSchema)
	var lease string
	err = service.db.QueryRowContext(ctx, `SELECT r.lease_token FROM chat_runs r JOIN chat_sessions s ON s.id=r.session_id WHERE r.id=? AND r.user_id=? AND r.status='running' AND r.invalidated=0 AND r.revision=s.revision AND r.lease_until>?`, run, user, time.Now().UnixMilli()).Scan(&lease)
	if err != nil || lease == "" {
		return s, t, "", "", errGenerationInactive
	}
	token := ""
	if encrypted != "" {
		token, err = decryptSecretWithKey(service.key, encrypted)
		if err != nil {
			return s, t, "", "", errMCPRemote
		}
	}
	return s, t, token, lease, nil
}
func (service *MCPService) Execute(ctx context.Context, user, run string, call ProviderToolCall) (result WebToolResult, returnErr error) {
	ctx, cancel := service.scope(ctx, 4*time.Minute)
	defer cancel()
	defer func() {
		if ctx.Err() != nil {
			returnErr = ctx.Err()
		}
	}()
	service.mu.Lock()
	server, tool, token, lease, err := service.checkCall(ctx, user, run, call.Name)
	if err != nil {
		service.mu.Unlock()
		return result, err
	}
	operation := newID()
	if service.active[server.ID] == nil {
		service.active[server.ID] = map[string]context.CancelFunc{}
	}
	service.active[server.ID][operation] = cancel
	service.mu.Unlock()
	defer func() {
		service.mu.Lock()
		delete(service.active[server.ID], operation)
		if len(service.active[server.ID]) == 0 {
			delete(service.active, server.ID)
		}
		service.mu.Unlock()
	}()
	args := call.Args
	if call.ArgsJSON != "" {
		if err := json.Unmarshal([]byte(call.ArgsJSON), &args); err != nil {
			return result, errors.New("MCP arguments must be a valid object")
		}
	}
	if args == nil {
		args = map[string]any{}
	}
	encoded, err := json.Marshal(args)
	if err != nil || len(encoded) > 64<<10 || !mcpValueDepth(args, 0) {
		return result, errors.New("MCP arguments exceed limits")
	}
	if token != "" && redactMCP(string(encoded), token) != string(encoded) {
		return result, errors.New("MCP arguments contain a protected credential")
	}
	var schema jsonschema.Schema
	if json.Unmarshal(tool.Schema, &schema) != nil {
		return result, errors.New("MCP tool schema is invalid")
	}
	resolved, err := schema.Resolve(nil)
	if err != nil || resolved.Validate(args) != nil {
		return result, errors.New("MCP arguments do not match the tool schema")
	}
	allowed, err := service.grantMatches(ctx, user, run, server, tool)
	if err != nil {
		return result, err
	}
	initialState := "pending"
	if allowed {
		initialState = "approved"
	}
	approvalID := newID()
	expires := time.Now().Add(3 * time.Minute).UnixMilli()
	_, err = service.db.ExecContext(ctx, `INSERT INTO mcp_approvals(id,user_id,server_id,tool_id,run_id,call_id,lease_token,server_revision,tool_schema,arguments_json,server_name,tool_name,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, approvalID, user, server.ID, tool.ID, run, call.ID, lease, server.Revision, string(tool.Schema), string(encoded), server.Name, tool.Name, initialState, time.Now().UnixMilli(), expires)
	if err != nil {
		return result, errors.New("MCP call cannot reuse an existing approval")
	}
	result.Details = map[string]any{"mcpServer": server.Name, "mcpTool": tool.Name, "approvalId": approvalID}
	defer func() {
		state := "completed"
		if returnErr != nil {
			state = "error"
			if ctx.Err() != nil {
				state = "cancelled"
			}
		}
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = service.db.ExecContext(cleanup, `UPDATE mcp_approvals SET state=? WHERE id=? AND user_id=? AND state IN ('pending','approved','executing')`, state, approvalID, user)
	}()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		current, currentTool, _, currentLease, err := service.checkCall(ctx, user, run, call.Name)
		if err != nil {
			return result, err
		}
		if current.Revision != server.Revision || currentLease != lease || string(currentTool.Schema) != string(tool.Schema) {
			return result, errors.New("MCP permissions changed; the call was not executed")
		}
		var state string
		if err := service.db.QueryRowContext(ctx, `SELECT state FROM mcp_approvals WHERE id=? AND user_id=?`, approvalID, user).Scan(&state); err != nil {
			return result, errors.New("MCP approval was revoked")
		}
		if state == "denied" {
			return result, errors.New("user denied this MCP tool call")
		}
		if time.Now().UnixMilli() >= expires || state == "expired" {
			_, _ = service.db.ExecContext(ctx, `UPDATE mcp_approvals SET state='expired' WHERE id=?`, approvalID)
			return result, errors.New("MCP approval expired without execution")
		}
		if state == "pending" {
			granted, grantErr := service.grantMatches(ctx, user, run, current, currentTool)
			if grantErr != nil {
				return result, grantErr
			}
			if granted {
				allowed = true
				_, err = service.db.ExecContext(ctx, `UPDATE mcp_approvals SET state='approved' WHERE id=? AND state='pending'`, approvalID)
				if err != nil {
					return result, err
				}
				continue
			}
		}
		if state == "approved" {
			break
		}
		if state != "pending" {
			return result, errors.New("MCP approval is no longer pending")
		}
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		case <-ticker.C:
		}
	}
	// Consume the exact approval and recheck permissions/ownership atomically before network execution.
	service.mu.Lock()
	current, currentTool, _, currentLease, err := service.checkCall(ctx, user, run, call.Name)
	if err != nil || current.Revision != server.Revision || currentLease != lease || string(currentTool.Schema) != string(tool.Schema) {
		service.mu.Unlock()
		return result, errors.New("MCP permission or ownership was revoked")
	}
	if allowed {
		granted, grantErr := service.grantMatches(ctx, user, run, current, currentTool)
		if grantErr != nil || !granted {
			service.mu.Unlock()
			return result, errors.New("MCP approval grant was revoked")
		}
	}
	claimed, err := service.db.ExecContext(ctx, `UPDATE mcp_approvals SET state='executing' WHERE id=? AND user_id=? AND state='approved' AND expires_at>?`, approvalID, user, time.Now().UnixMilli())
	service.mu.Unlock()
	if err != nil {
		return result, err
	}
	n, _ := claimed.RowsAffected()
	if n != 1 {
		return result, errors.New("MCP approval was already consumed")
	}
	if ctx.Err() != nil {
		return result, ctx.Err()
	}
	var progressMu sync.Mutex
	var lastProgress time.Time
	session, release, err := service.borrowSession(ctx, server, token, func(params *mcp.ProgressNotificationParams) {
		if params.ProgressToken != approvalID {
			return
		}
		progressMu.Lock()
		if !lastProgress.IsZero() && time.Since(lastProgress) < 200*time.Millisecond {
			progressMu.Unlock()
			return
		}
		lastProgress = time.Now()
		progressMu.Unlock()
		progress := map[string]any{"progress": params.Progress, "total": params.Total, "message": redactMCP(params.Message, token)}
		encoded, marshalErr := json.Marshal(progress)
		if marshalErr == nil && len(encoded) <= 4096 {
			_, _ = service.db.ExecContext(ctx, `UPDATE mcp_approvals SET progress_json=? WHERE id=? AND state='executing'`, string(encoded), approvalID)
		}
	})
	if err != nil {
		return result, err
	}
	defer func() {
		// The SDK sends cancellation notifications asynchronously; permit bounded delivery before teardown.
		if ctx.Err() != nil {
			timer := time.NewTimer(250 * time.Millisecond)
			<-timer.C
		}
		release(returnErr == nil && ctx.Err() == nil)
	}()
	params := &mcp.CallToolParams{Name: tool.Name, Arguments: args}
	params.SetProgressToken(approvalID)
	response, err := session.CallTool(ctx, params)
	if err != nil || response == nil {
		return result, errors.New("MCP call failed; its outcome may be uncertain. Verify external state before retrying")
	}
	if response.NeedsInput() {
		return result, errors.New("remote MCP tool requested unsupported interactive input")
	}
	output, err := json.Marshal(response)
	if err != nil || len(output) > 256<<10 {
		return result, errors.New("MCP result exceeded the 256 KiB limit; verify external state before retrying")
	}
	result.Content = redactMCP(string(output), token)
	result.Details["isError"] = response.IsError
	if response.IsError {
		return result, errors.New("remote MCP tool reported an error")
	}
	return result, nil
}
