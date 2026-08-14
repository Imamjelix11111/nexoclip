ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS vimax_session_id TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_request_id TEXT,
  ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS generation_jobs_provider_request_idx
  ON generation_jobs (workspace_id, provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;
