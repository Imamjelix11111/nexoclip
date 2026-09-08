INSERT INTO pricing_rules (pricing_version_id, operation, unit, unit_price, metadata)
SELECT id, 'video_generation', 'job', 10.000000::numeric,
  '{"development": true, "provider": "provider_router", "provisional": true}'::jsonb
FROM pricing_versions
WHERE status = 'active'
ON CONFLICT (pricing_version_id, operation) DO NOTHING;
