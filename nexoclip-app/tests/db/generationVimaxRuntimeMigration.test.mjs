import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../../src/db/migrations/017_generation_vimax_runtime.sql', import.meta.url);

test('adds ViMax provider submission and progress fields to generation jobs', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS vimax_session_id TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS provider_request_id TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS progress JSONB/);
  assert.match(sql, /generation_jobs_provider_request_idx/);
});
