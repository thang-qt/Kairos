ALTER TABLE user_providers ADD COLUMN use_responses_api INTEGER NOT NULL DEFAULT 0;
UPDATE user_providers SET kind='openai',use_responses_api=1 WHERE kind='openai-responses';
