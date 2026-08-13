ALTER TABLE generation_jobs
  DROP CONSTRAINT IF EXISTS generation_jobs_status_check;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_status_check
  CHECK (status IN ('queued', 'running', 'processing', 'succeeded', 'failed', 'canceled'));

ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timeout_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS generation_jobs_retry_idx
  ON generation_jobs (next_attempt_at, created_at, id)
  WHERE status = 'queued';
