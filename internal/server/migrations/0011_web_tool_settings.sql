CREATE TABLE IF NOT EXISTS user_web_tool_settings (
    user_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'exa',
    encrypted_api_key TEXT NOT NULL DEFAULT '',
    search_max_results INTEGER NOT NULL DEFAULT 5,
    fetch_max_characters INTEGER NOT NULL DEFAULT 10000,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
