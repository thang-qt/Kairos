CREATE TABLE IF NOT EXISTS chat_runs (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
	status TEXT NOT NULL,
	model TEXT NOT NULL,
	request_json TEXT,
	error_message TEXT,
	started_at INTEGER NOT NULL,
	completed_at INTEGER,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_runs_session_created
ON chat_runs(session_id, created_at ASC, id ASC);
