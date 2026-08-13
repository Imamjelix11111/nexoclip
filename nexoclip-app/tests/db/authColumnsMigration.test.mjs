import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('auth columns migration adds password credentials safely', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/003_user_password.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS password_hash TEXT/);
  assert.match(sql, /ALTER COLUMN email SET NOT NULL/);
  assert.match(sql, /ALTER COLUMN password_hash SET NOT NULL/);
});
