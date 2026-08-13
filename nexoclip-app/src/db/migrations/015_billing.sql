CREATE TABLE IF NOT EXISTS billing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  monthly_credits NUMERIC(20, 6) NOT NULL CHECK (monthly_credits >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing plans remain the generation catalog. Billing plans are a reversible
-- billing boundary and may later be mapped to a provider catalog.
INSERT INTO billing_plans (code, name, description, monthly_credits, metadata, active)
SELECT code, name, description, monthly_credits, metadata, active FROM plans
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  billing_plan_id UUID NOT NULL REFERENCES billing_plans(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'canceled')),
  provider_key TEXT,
  provider_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id),
  UNIQUE (provider_key, provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS workspace_subscriptions_workspace_idx
  ON workspace_subscriptions (workspace_id);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  processing_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (provider_key, event_id)
);
