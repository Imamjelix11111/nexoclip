ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS claim_token UUID;

CREATE INDEX IF NOT EXISTS generation_jobs_terminal_pending_settlement_idx
  ON generation_jobs (workspace_id, settlement_status, status)
  WHERE settlement_status = 'pending' AND status IN ('succeeded', 'failed');
