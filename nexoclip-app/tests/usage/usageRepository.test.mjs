import test from 'node:test';
import assert from 'node:assert/strict';
import { getUsageSummary, listUsageHistory } from '../../src/repositories/usageRepository.js';

function pool() {
  const calls = [];
  return { calls, async query(text, values) { calls.push({ text, values }); return { rows: [], rowCount: 0 }; } };
}

test('my usage filters by workspace and authenticated actor', async () => {
  const db = pool();
  await listUsageHistory(db, { workspaceId: 'w1', userId: 'u1', scope: 'me', page: 1, pageSize: 25 });
  assert.match(db.calls[0].text, /gj\.workspace_id = \$1/);
  assert.match(db.calls[0].text, /gj\.created_by_user_id = \$2/);
  assert.deepEqual(db.calls[0].values.slice(0, 2), ['w1', 'u1']);
  assert.doesNotMatch(db.calls[0].text, /raw_usage/);
});

test('workspace usage omits actor filter and uses canonical settlement charge', async () => {
  const db = pool();
  await getUsageSummary(db, { workspaceId: 'w1', userId: 'u1', scope: 'workspace', periodStart: new Date('2026-09-01T00:00:00Z') });
  assert.doesNotMatch(db.calls[0].text, /created_by_user_id =/);
  assert.match(db.calls[0].text, /settlement_status = 'captured'/);
  assert.match(db.calls[0].text, /credit_ledger/);
  assert.match(db.calls[0].text, /reservation_ledger_id/);
  assert.match(db.calls[0].text, /generation_capture/);
  assert.match(db.calls[0].text, /settlement_status IN \('released', 'refunded'\)/);
  assert.doesNotMatch(db.calls[0].text, /pu\.actual_cost/);
});
