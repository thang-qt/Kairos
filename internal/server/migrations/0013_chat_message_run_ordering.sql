ALTER TABLE chat_messages ADD COLUMN run_id TEXT;
ALTER TABLE chat_messages ADD COLUMN round_index INTEGER;
ALTER TABLE chat_messages ADD COLUMN message_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_run_order
ON chat_messages(session_id, run_id, round_index, message_index, timestamp, created_at, id);
