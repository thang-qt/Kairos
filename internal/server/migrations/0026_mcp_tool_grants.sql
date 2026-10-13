CREATE TABLE mcp_tool_grants (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 server_id TEXT NOT NULL REFERENCES user_mcp_servers(id) ON DELETE CASCADE,
 tool_id TEXT NOT NULL REFERENCES user_mcp_tools(id) ON DELETE CASCADE,
 session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
 server_revision INTEGER NOT NULL,
 tool_schema TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX mcp_grant_scope ON mcp_tool_grants(user_id,tool_id,COALESCE(session_id,''));
