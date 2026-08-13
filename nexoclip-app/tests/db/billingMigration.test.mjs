import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('billing migration defines tenant subscriptions and idempotent webhook events', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/015_billing.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS billing_plans/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS workspace_subscriptions/);
  assert.match(sql, /workspace_id UUID NOT NULL REFERENCES workspaces/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS billing_webhook_events/);
  assert.match(sql, /UNIQUE \(provider_key, event_id\)/);
  assert.match(sql, /CHECK \(status IN \('pending', 'processed', 'failed'\)\)/);
});
