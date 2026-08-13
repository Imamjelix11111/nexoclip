import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCreditAccount,
  findCreditEntryByIdempotencyKey,
  insertCreditEntry,
  lockCreditAccount,
} from '../../src/repositories/creditRepository.js';

function clientFor(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      return { rows };
    },
  };
}

test('creates one credit account per workspace', async () => {
  const client = clientFor([{ workspace_id: 'w1', balance: '0' }]);
  const account = await createCreditAccount(client, 'w1');
  assert.equal(account.workspace_id, 'w1');
  assert.deepEqual(client.calls[0].values, ['w1']);
  assert.match(client.calls[0].text, /ON CONFLICT \(workspace_id\) DO NOTHING/);
});

test('locks a workspace credit account before calculating a new balance', async () => {
  const client = clientFor([{ workspace_id: 'w1', balance: '10' }]);
  const account = await lockCreditAccount(client, 'w1');
  assert.equal(account.balance, '10');
  assert.deepEqual(client.calls[0].values, ['w1']);
  assert.match(client.calls[0].text, /FOR UPDATE/);
});

test('finds an existing ledger entry by workspace and idempotency key', async () => {
  const client = clientFor([{ id: 'entry-1', amount: '10' }]);
  const entry = await findCreditEntryByIdempotencyKey(client, 'w1', 'grant-1');
  assert.equal(entry.id, 'entry-1');
  assert.deepEqual(client.calls[0].values, ['w1', 'grant-1']);
  assert.match(client.calls[0].text, /workspace_id = \$1 AND idempotency_key = \$2/);
});

test('inserts an append-only ledger entry with its resulting balance', async () => {
  const client = clientFor([{ id: 'entry-1', balance_after: '10' }]);
  const entry = await insertCreditEntry(client, {
    workspaceId: 'w1',
    amount: 10,
    balanceAfter: 10,
    reason: 'grant',
    idempotencyKey: 'grant-1',
    metadata: { source: 'development' },
  });
  assert.equal(entry.id, 'entry-1');
  assert.deepEqual(client.calls[0].values, ['w1', 10, 10, 'grant', 'grant-1', '{"source":"development"}']);
  assert.match(client.calls[0].text, /INSERT INTO credit_ledger/);
});
