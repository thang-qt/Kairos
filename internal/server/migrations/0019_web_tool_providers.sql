CREATE TABLE IF NOT EXISTS user_web_tool_providers (
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    encrypted_api_key TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, provider),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Existing installations keep their Exa key and continue using Exa by default.
INSERT OR IGNORE INTO user_web_tool_providers (user_id, provider, encrypted_api_key, enabled, updated_at)
SELECT user_id, 'exa', encrypted_api_key, 1, updated_at
FROM user_web_tool_settings;
