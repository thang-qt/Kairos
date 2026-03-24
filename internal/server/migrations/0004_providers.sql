ALTER TABLE user_preferences ADD COLUMN default_model_id TEXT;

CREATE TABLE IF NOT EXISTS user_providers (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind TEXT NOT NULL,
	label TEXT NOT NULL,
	base_url TEXT NOT NULL DEFAULT '',
	api_key_encrypted TEXT NOT NULL,
	is_enabled INTEGER NOT NULL DEFAULT 1,
	supports_model_sync INTEGER NOT NULL DEFAULT 1,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_providers_user_updated
ON user_providers(user_id, updated_at DESC, created_at DESC, id DESC);
