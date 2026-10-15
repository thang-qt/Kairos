CREATE TABLE chat_assets (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 backend TEXT NOT NULL,
 object_key TEXT NOT NULL,
 media_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX idx_chat_assets_user ON chat_assets(user_id);
