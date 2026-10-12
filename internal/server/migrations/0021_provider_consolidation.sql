UPDATE user_providers SET base_url=CASE WHEN base_url='' THEN 'https://openrouter.ai/api/v1' ELSE base_url END,kind='openai' WHERE kind='openrouter';
