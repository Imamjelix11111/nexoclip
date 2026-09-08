ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID
  REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS generation_jobs_workspace_user_created_idx
  ON generation_jobs (workspace_id, created_by_user_id, created_at DESC);
