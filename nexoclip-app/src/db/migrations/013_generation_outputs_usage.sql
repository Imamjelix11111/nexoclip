CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_workspace_id_idx
  ON generation_jobs (workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS assets_workspace_id_id_idx
  ON assets (workspace_id, id);

CREATE TABLE IF NOT EXISTS generation_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  generation_job_id UUID NOT NULL,
  provider_request_id TEXT NOT NULL,
  output_index INTEGER NOT NULL CHECK (output_index >= 0),
  asset_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT generation_outputs_job_workspace_fk
    FOREIGN KEY (workspace_id, generation_job_id)
    REFERENCES generation_jobs(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT generation_outputs_asset_workspace_fk
    FOREIGN KEY (workspace_id, asset_id)
    REFERENCES assets(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT generation_outputs_unique_output
    UNIQUE (workspace_id, generation_job_id, provider_request_id, output_index)
);

CREATE INDEX IF NOT EXISTS generation_outputs_workspace_job_idx
  ON generation_outputs (workspace_id, generation_job_id, output_index);

CREATE TABLE IF NOT EXISTS provider_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  generation_job_id UUID NOT NULL,
  provider TEXT NOT NULL,
  provider_request_id TEXT NOT NULL,
  estimated_cost NUMERIC(20, 8),
  actual_cost NUMERIC(20, 8),
  units JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT provider_usage_job_workspace_fk
    FOREIGN KEY (workspace_id, generation_job_id)
    REFERENCES generation_jobs(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT provider_usage_unique_request
    UNIQUE (workspace_id, generation_job_id, provider_request_id)
);

CREATE INDEX IF NOT EXISTS provider_usage_workspace_job_idx
  ON provider_usage (workspace_id, generation_job_id);
