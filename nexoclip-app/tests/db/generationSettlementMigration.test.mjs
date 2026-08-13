import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('settlement migration adds a tenant-safe idempotent generation settlement state', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/014_generation_credit_settlement.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS settlement_status/);
  assert.match(sql, /'pending', 'captured', 'released', 'refunded'/);
  assert.match(sql, /generation_jobs_workspace_settlement_idx/);
});
