ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(20, 6),
  ADD COLUMN IF NOT EXISTS pricing_version_id UUID REFERENCES pricing_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reservation_ledger_id UUID REFERENCES credit_ledger(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_workspace_idempotency_idx
  ON generation_jobs (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
