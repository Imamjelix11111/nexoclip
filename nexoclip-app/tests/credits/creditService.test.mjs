import test from 'node:test';
import assert from 'node:assert/strict';
import { appendCreditEntry } from '../../src/services/creditService.js';

function poolFor() {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (/INSERT INTO credit_accounts/.test(text)) return { rows: [{ workspace_id: 'w1', balance: '0' }] };
      if (/FOR UPDATE/.test(text)) return { rows: [{ workspace_id: 'w1', balance: '5' }] };
      if (/SELECT/.test(text) && /idempotency_key/.test(text)) return { rows: [] };
      if (/UPDATE credit_accounts/.test(text)) return { rows: [{ workspace_id: 'w1', balance: '8' }] };
      if (/INSERT INTO credit_ledger/.test(text)) return { rows: [{ id: 'entry-1', balance_after: '8' }] };
      return { rows: [] };
    },
    release() {},
  };
  return { calls, async connect() { return client; } };
}

test('appends a credit entry transactionally and returns the resulting balance', async () => {
  const pool = poolFor();
  const entry = await appendCreditEntry(pool, {
    workspaceId: 'w1', amount: 3, reason: 'grant', idempotencyKey: 'grant-1', metadata: {},
  });
  assert.equal(entry.id, 'entry-1');
  assert.equal(pool.calls[0].text, 'BEGIN');
  assert.match(pool.calls[1].text, /INSERT INTO credit_accounts \(workspace_id\) VALUES \(\$1\).*ON CONFLICT \(workspace_id\) DO NOTHING/s);
  assert.equal(pool.calls.at(-1).text, 'COMMIT');
});

test('rejects a debit that would make the account negative', async () => {
  const pool = poolFor();
  await assert.rejects(
    appendCreditEntry(pool, { workspaceId: 'w1', amount: -6, reason: 'reserve', idempotencyKey: 'reserve-1' }),
    /Insufficient credits/,
  );
  assert.equal(pool.calls.at(-1).text, 'ROLLBACK');
});
