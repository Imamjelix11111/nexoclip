import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('generation output and provider usage migration is tenant-scoped and idempotent', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/013_generation_outputs_usage.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS generation_outputs/);
  assert.match(sql, /generation_outputs_unique_output[\s\S]*UNIQUE \(workspace_id, generation_job_id, provider_request_id, output_index\)/);
  assert.match(sql, /REFERENCES assets\(workspace_id, id\) ON DELETE RESTRICT/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS provider_usage/);
  assert.match(sql, /provider_usage_unique_request[\s\S]*UNIQUE \(workspace_id, generation_job_id, provider_request_id\)/);
  assert.match(sql, /raw_usage JSONB NOT NULL/);
});
