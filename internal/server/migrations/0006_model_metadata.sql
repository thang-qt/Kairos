CREATE TABLE IF NOT EXISTS user_model_metadata (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	model_id TEXT NOT NULL,
	name TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	context_window INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY(user_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_user_model_metadata_user_updated
ON user_model_metadata(user_id, updated_at DESC, model_id);
