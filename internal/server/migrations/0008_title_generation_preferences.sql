ALTER TABLE user_preferences ADD COLUMN auto_generate_title INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN use_separate_title_model INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN title_generation_model_id TEXT;
