CREATE INDEX idx_chat_sessions_user_page
ON chat_sessions(user_id, is_pinned DESC, updated_at DESC, created_at DESC, id DESC);
