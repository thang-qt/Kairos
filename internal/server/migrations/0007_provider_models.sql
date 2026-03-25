CREATE TABLE IF NOT EXISTS provider_model_cache_state (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	provider_ref TEXT NOT NULL,
	last_synced_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	PRIMARY KEY(user_id, provider_ref)
);

CREATE INDEX IF NOT EXISTS idx_provider_model_cache_state_user_expires
ON provider_model_cache_state(user_id, expires_at ASC, provider_ref);

CREATE TABLE IF NOT EXISTS provider_models (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	provider_ref TEXT NOT NULL,
	model_id TEXT NOT NULL,
	object TEXT NOT NULL DEFAULT 'model',
	created INTEGER NOT NULL DEFAULT 0,
	owned_by TEXT NOT NULL DEFAULT '',
	name TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	context_window INTEGER NOT NULL DEFAULT 0,
	fetched_at INTEGER NOT NULL,
	PRIMARY KEY(user_id, provider_ref, model_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_models_user_provider
ON provider_models(user_id, provider_ref, model_id);
