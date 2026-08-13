import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('generation limits migration defines configurable tenant controls and active-job index', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/016_generation_limits.sql', import.meta.url), 'utf8');
  assert.match(sql, /workspace_generation_limits/);
  assert.match(sql, /rate_limit INTEGER/);
  assert.match(sql, /max_concurrent INTEGER/);
  assert.match(sql, /budget_credits NUMERIC/);
  assert.match(sql, /generation_jobs_workspace_active_idx/);
});
