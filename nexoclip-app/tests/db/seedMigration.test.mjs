import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = new URL('../../src/db/migrations/010_seed_plans_providers.sql', import.meta.url);

test('seed migration defines plan and provider registries with stable conflict keys', async () => {
  const sql = await readFile(migration, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS plans/);
  assert.match(sql, /code TEXT NOT NULL UNIQUE/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS provider_registry/);
  assert.match(sql, /provider_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /INSERT INTO plans/);
  assert.match(sql, /INSERT INTO provider_registry/);
  assert.match(sql, /ON CONFLICT \(code\) DO UPDATE/);
  assert.match(sql, /ON CONFLICT \(provider_key\) DO UPDATE/);
  assert.match(sql, /ON CONFLICT \(version\) DO UPDATE/);
  assert.match(sql, /ON CONFLICT \(pricing_version_id, operation\) DO UPDATE/);
});

test('seed migration contains safe development catalog data without provider secrets', async () => {
  const sql = await readFile(migration, 'utf8');

  assert.match(sql, /'free'/);
  assert.match(sql, /'starter'/);
  assert.match(sql, /'muapi'/);
  assert.match(sql, /'development'/);
  assert.doesNotMatch(sql, /MUAPI_API_KEY|MU_API_KEY|api[_-]?key\s*=/i);
  assert.match(sql, /pricing_versions/);
  assert.match(sql, /pricing_rules/);
});
