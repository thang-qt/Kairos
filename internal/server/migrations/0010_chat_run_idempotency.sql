ALTER TABLE chat_runs ADD COLUMN idempotency_key TEXT;
ALTER TABLE chat_runs ADD COLUMN assistant_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_runs_user_session_idempotency
ON chat_runs(user_id, session_id, idempotency_key)
WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';
