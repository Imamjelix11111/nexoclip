import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('pricing migration stores immutable versioned provider-neutral rules', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/008_pricing.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pricing_versions/);
  assert.match(sql, /version INTEGER NOT NULL/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pricing_rules/);
  assert.match(sql, /pricing_version_id UUID NOT NULL REFERENCES pricing_versions/);
  assert.match(sql, /unit_price NUMERIC\(20, 6\) NOT NULL/);
  assert.match(sql, /UNIQUE \(pricing_version_id, operation\)/);
});
