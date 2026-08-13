import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('generation migration defines tenant-scoped queued image jobs', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/006_generation_jobs.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS generation_jobs/);
  assert.match(sql, /workspace_id UUID NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(sql, /FOREIGN KEY \(workspace_id, project_id\) REFERENCES projects\(workspace_id, id\)/);
  assert.match(sql, /status TEXT NOT NULL DEFAULT 'queued'/);
  assert.match(sql, /CHECK \(kind = 'image'\)/);
});
