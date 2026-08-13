import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('projects migration defines workspace-scoped projects', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/004_projects.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS projects/);
  assert.match(sql, /workspace_id UUID NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(sql, /UNIQUE \(workspace_id, slug\)/);
});
