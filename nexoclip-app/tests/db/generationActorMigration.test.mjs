import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('generation actor migration adds nullable ownership and lookup index', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/021_generation_actor.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS created_by_user_id UUID/);
  assert.match(sql, /REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(sql, /created_by_user_id UUID NOT NULL/);
  assert.match(sql, /ON generation_jobs \(workspace_id, created_by_user_id, created_at DESC\)/);
});
