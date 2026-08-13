ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (settlement_status IN ('pending', 'captured', 'released', 'refunded'));

CREATE INDEX IF NOT EXISTS generation_jobs_workspace_settlement_idx
  ON generation_jobs (workspace_id, settlement_status);
