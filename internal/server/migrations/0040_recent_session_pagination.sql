CREATE INDEX idx_chat_sessions_user_recent_page
ON chat_sessions(user_id, updated_at DESC, id ASC);
