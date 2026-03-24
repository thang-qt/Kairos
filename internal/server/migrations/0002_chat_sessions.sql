CREATE TABLE IF NOT EXISTS user_preferences (
	user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	use_system_providers INTEGER NOT NULL DEFAULT 1,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	friendly_id TEXT NOT NULL UNIQUE,
	title TEXT,
	derived_title TEXT,
	label TEXT,
	updated_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	last_message_json TEXT,
	total_tokens INTEGER NOT NULL DEFAULT 0,
	context_tokens INTEGER NOT NULL DEFAULT 32768,
	parent_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
	parent_friendly_id TEXT,
	fork_point_message_id TEXT,
	fork_depth INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated
ON chat_sessions(user_id, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
	role TEXT NOT NULL,
	model TEXT,
	model_name TEXT,
	model_description TEXT,
	content_json TEXT NOT NULL,
	tool_call_id TEXT,
	tool_name TEXT,
	details_json TEXT,
	is_error INTEGER NOT NULL DEFAULT 0,
	timestamp INTEGER NOT NULL,
	client_id TEXT,
	message_json TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_time
ON chat_messages(session_id, timestamp ASC, created_at ASC, id ASC);
