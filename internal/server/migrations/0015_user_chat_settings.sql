ALTER TABLE user_preferences
ADD COLUMN default_chat_settings_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS user_model_chat_settings (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	model_id TEXT NOT NULL,
	settings_json TEXT NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, model_id)
);
