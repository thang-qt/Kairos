ALTER TABLE chat_sessions
ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_pinned_updated
ON chat_sessions(user_id, is_pinned DESC, updated_at DESC, created_at DESC);
