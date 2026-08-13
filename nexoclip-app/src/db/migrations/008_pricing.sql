CREATE TABLE IF NOT EXISTS pricing_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL UNIQUE CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'retired')),
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricing_version_id UUID NOT NULL REFERENCES pricing_versions(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_price NUMERIC(20, 6) NOT NULL CHECK (unit_price >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (pricing_version_id, operation)
);

CREATE INDEX IF NOT EXISTS pricing_versions_active_idx
  ON pricing_versions (effective_at DESC) WHERE status = 'active';
