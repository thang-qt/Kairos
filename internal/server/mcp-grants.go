package server

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// Grants bind the user's explicit choice to one server configuration and tool schema.
func (service *MCPService) grantMatches(ctx context.Context, user, run string, server MCPServer, tool MCPTool) (bool, error) {
	var count int
	err := service.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mcp_tool_grants g JOIN chat_runs r ON r.id=? AND r.user_id=g.user_id WHERE g.user_id=? AND g.server_id=? AND g.tool_id=? AND g.server_revision=? AND g.tool_schema=? AND (g.session_id IS NULL OR g.session_id=r.session_id)`, run, user, server.ID, tool.ID, server.Revision, string(tool.Schema)).Scan(&count)
	return count > 0, err
}

func writeMCPGrant(ctx context.Context, tx *sql.Tx, user, server, tool string, session any, revision int64, schema string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO mcp_tool_grants(id,user_id,server_id,tool_id,session_id,server_revision,tool_schema,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET server_revision=excluded.server_revision,tool_schema=excluded.tool_schema,created_at=excluded.created_at`, newID(), user, server, tool, session, revision, schema, time.Now().UnixMilli())
	return err
}

func (service *MCPService) enableDiscovered(ctx context.Context, user, id string) error {
	service.mu.Lock()
	defer service.mu.Unlock()
	if _, _, err := service.get(ctx, user, id); err != nil {
		return err
	}
	var total int
	if err := service.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_mcp_tools t JOIN user_mcp_servers s ON s.id=t.server_id WHERE s.user_id=? AND ((t.server_id=? AND t.available=1) OR (t.server_id!=? AND t.enabled=1))`, user, id, id).Scan(&total); err != nil {
		return err
	}
	if total > mcpMaxEnabledTools {
		return errors.New("connection saved; enable at most 512 remote tools across your servers")
	}
	_, err := service.db.ExecContext(ctx, `UPDATE user_mcp_tools SET enabled=1 WHERE server_id=? AND available=1`, id)
	return err
}

func validateMCPScope(decision, scope string) error {
	if scope != "once" && scope != "chat" && scope != "tool" {
		return errors.New("approval scope must be once, chat or tool")
	}
	if decision != "approved" && scope != "once" {
		return errors.New("denial cannot create an approval grant")
	}
	return nil
}
