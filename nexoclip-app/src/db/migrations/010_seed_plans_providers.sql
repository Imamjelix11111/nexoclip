CREATE TABLE IF NOT EXISTS plans (
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

CREATE TABLE IF NOT EXISTS provider_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plans (code, name, description, monthly_credits, metadata, active)
VALUES
  ('free', 'Free', 'Development plan for trying the NexoClip SaaS foundation.', 25, '{"development": true, "limits": {"concurrent_jobs": 1}}'::jsonb, true),
  ('starter', 'Starter', 'Development plan for small teams testing generation workflows.', 250, '{"development": true, "limits": {"concurrent_jobs": 2}}'::jsonb, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  monthly_credits = EXCLUDED.monthly_credits,
  metadata = EXCLUDED.metadata,
  active = EXCLUDED.active,
  updated_at = now();

INSERT INTO provider_registry (provider_key, display_name, kind, status, metadata)
VALUES
  ('muapi', 'MuAPI', 'inference', 'active', '{"development": true, "credential_location": "server_or_worker_environment"}'::jsonb),
  ('development', 'Development Stub', 'inference', 'active', '{"development": true, "credential_location": "none"}'::jsonb)
ON CONFLICT (provider_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  kind = EXCLUDED.kind,
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO pricing_versions (version, status, effective_at)
VALUES (1, 'active', TIMESTAMPTZ '2026-01-01 00:00:00+00')
ON CONFLICT (version) DO UPDATE SET
  status = EXCLUDED.status,
  effective_at = EXCLUDED.effective_at;

INSERT INTO pricing_rules (pricing_version_id, operation, unit, unit_price, metadata)
SELECT id, seed.operation, seed.unit, seed.unit_price, seed.metadata::jsonb
FROM pricing_versions
CROSS JOIN (VALUES
  ('image_generation', 'job', 2.500000::numeric, '{"development": true, "provider": "muapi"}'),
  ('image.generate', 'image', 2.500000::numeric, '{"development": true, "provider": "muapi"}')
) AS seed(operation, unit, unit_price, metadata)
WHERE version = 1
ON CONFLICT (pricing_version_id, operation) DO UPDATE SET
  unit = EXCLUDED.unit,
  unit_price = EXCLUDED.unit_price,
  metadata = EXCLUDED.metadata;
