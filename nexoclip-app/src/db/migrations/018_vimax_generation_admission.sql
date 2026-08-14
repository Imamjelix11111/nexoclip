ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_kind_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_kind_check
  CHECK (kind IN ('image', 'vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video'));

INSERT INTO pricing_rules (pricing_version_id, operation, unit, unit_price, metadata)
SELECT id, seed.operation, 'job', seed.unit_price,
       '{"provider":"vimax","development":true,"configurable":true}'::jsonb
FROM pricing_versions
CROSS JOIN (VALUES
  ('vimax_narrative_planning', 0.000000::numeric),
  ('vimax_novel_planning', 0.000000::numeric),
  ('vimax_render_video', 0.000000::numeric)
) AS seed(operation, unit_price)
WHERE version = 1
ON CONFLICT (pricing_version_id, operation) DO NOTHING;
