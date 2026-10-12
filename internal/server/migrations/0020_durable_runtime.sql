ALTER TABLE chat_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_runs ADD COLUMN lease_token TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_runs ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_runs ADD COLUMN user_message_id TEXT;
ALTER TABLE chat_runs ADD COLUMN turn_json TEXT;
ALTER TABLE chat_runs ADD COLUMN invalidated INTEGER NOT NULL DEFAULT 0;
CREATE TABLE chat_jobs (
 run_id TEXT PRIMARY KEY REFERENCES chat_runs(id) ON DELETE CASCADE,
 available_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE chat_run_steps (
 run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
 step_id TEXT NOT NULL,
 message_json TEXT NOT NULL,
 timestamp INTEGER NOT NULL,
 PRIMARY KEY(run_id, step_id)
);
CREATE TABLE chat_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 event_json TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX idx_chat_events_session ON chat_events(session_id, sequence);
-- Old in-flight work has no safe execution checkpoint. Keep its transcript readable.
UPDATE chat_runs SET status = 'interrupted', error_message = 'Server restarted before durable scheduling was installed' WHERE status = 'running';
CREATE UNIQUE INDEX idx_chat_runs_active_session ON chat_runs(session_id) WHERE status IN ('queued', 'preparing', 'running');
CREATE TABLE chat_retry_commands (
 run_id TEXT NOT NULL REFERENCES chat_runs(id) ON DELETE CASCADE,
 command_key TEXT NOT NULL,
 PRIMARY KEY(run_id,command_key)
);
