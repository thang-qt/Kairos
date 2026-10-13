CREATE TABLE user_mcp_servers (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, endpoint TEXT NOT NULL, auth_mode TEXT NOT NULL CHECK(auth_mode IN ('none','bearer')),
 token_encrypted TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 1, health TEXT NOT NULL DEFAULT 'untested', last_error TEXT NOT NULL DEFAULT '',
 discovered_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX mcp_servers_owner ON user_mcp_servers(user_id);
CREATE TABLE user_mcp_tools (
 id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES user_mcp_servers(id) ON DELETE CASCADE,
 name TEXT NOT NULL, alias TEXT NOT NULL UNIQUE, description TEXT NOT NULL, schema_json TEXT NOT NULL,
 annotations_json TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 0,
 available INTEGER NOT NULL DEFAULT 1, approval_policy TEXT NOT NULL DEFAULT 'always' CHECK(approval_policy='always'),
 UNIQUE(server_id,name)
);
CREATE TABLE mcp_approvals (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 server_id TEXT NOT NULL REFERENCES user_mcp_servers(id) ON DELETE CASCADE,
 tool_id TEXT NOT NULL REFERENCES user_mcp_tools(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE, call_id TEXT NOT NULL,
 lease_token TEXT NOT NULL, server_revision INTEGER NOT NULL, tool_schema TEXT NOT NULL,
 arguments_json TEXT NOT NULL, server_name TEXT NOT NULL, tool_name TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','approved','denied','executing','completed','error','cancelled','expired')),
 progress_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 UNIQUE(run_id,lease_token,call_id)
);
CREATE INDEX mcp_approval_owner ON mcp_approvals(user_id,state);
