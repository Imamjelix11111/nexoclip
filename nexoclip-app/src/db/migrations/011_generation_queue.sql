ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS queue_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queue_published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS generation_jobs_queue_recovery_idx
  ON generation_jobs (created_at, id)
  WHERE status = 'queued' AND queue_published_at IS NULL;
