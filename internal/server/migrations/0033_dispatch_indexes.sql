CREATE INDEX idx_chat_runs_status_lease ON chat_runs(status,lease_until);
CREATE INDEX idx_chat_jobs_available ON chat_jobs(available_at,run_id);
