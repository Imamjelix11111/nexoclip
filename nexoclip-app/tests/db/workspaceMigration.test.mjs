import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../../src/db/migrations/002_workspaces.sql', import.meta.url);

test('workspace migration defines tenant and membership constraints', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS workspaces/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS workspace_memberships/);
  assert.match(sql, /UNIQUE \(workspace_id, user_id\)/);
  assert.match(sql, /CHECK \(role IN \('owner', 'admin', 'member'\)\)/);
  assert.match(sql, /ON DELETE CASCADE/);
});
