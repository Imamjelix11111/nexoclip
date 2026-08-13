CREATE TABLE IF NOT EXISTS credit_accounts (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  balance NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  amount NUMERIC(20, 6) NOT NULL CHECK (amount <> 0),
  balance_after NUMERIC(20, 6) NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS credit_ledger_workspace_created_idx
  ON credit_ledger (workspace_id, created_at DESC);
