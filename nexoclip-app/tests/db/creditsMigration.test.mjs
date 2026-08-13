import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('credits migration defines tenant-scoped account and idempotent append-only ledger', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/007_credits.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS credit_accounts/);
  assert.match(sql, /workspace_id UUID NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS credit_ledger/);
  assert.match(sql, /UNIQUE \(workspace_id, idempotency_key\)/);
  assert.match(sql, /balance_after NUMERIC\(20, 6\) NOT NULL/);
  assert.match(sql, /CHECK \(amount <> 0\)/);
});
