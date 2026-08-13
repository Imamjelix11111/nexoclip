import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('assets migration defines tenant-scoped object metadata', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/005_assets.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS assets/);
  assert.match(sql, /workspace_id UUID NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(sql, /storage_key TEXT NOT NULL UNIQUE/);
});
