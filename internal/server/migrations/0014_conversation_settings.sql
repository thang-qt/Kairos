ALTER TABLE chat_sessions
ADD COLUMN conversation_settings_json TEXT NOT NULL DEFAULT '{}';
