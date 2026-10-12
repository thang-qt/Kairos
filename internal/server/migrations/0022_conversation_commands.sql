CREATE TABLE conversation_commands (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 command_key TEXT NOT NULL,
 session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,command_key)
);
