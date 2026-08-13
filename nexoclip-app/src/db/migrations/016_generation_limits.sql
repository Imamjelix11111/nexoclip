CREATE TABLE IF NOT EXISTS workspace_generation_limits (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  rate_limit INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit > 0),
  rate_window_seconds INTEGER NOT NULL DEFAULT 60 CHECK (rate_window_seconds > 0),
  max_concurrent INTEGER NOT NULL DEFAULT 2 CHECK (max_concurrent > 0),
  budget_credits NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (budget_credits >= 0),
  budget_period TEXT NOT NULL DEFAULT 'calendar_month' CHECK (budget_period = 'calendar_month'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generation_jobs_workspace_active_idx
  ON generation_jobs (workspace_id, status) WHERE status IN ('queued', 'running', 'processing');
CREATE INDEX IF NOT EXISTS generation_jobs_workspace_created_cost_idx
  ON generation_jobs (workspace_id, created_at, estimated_cost);
