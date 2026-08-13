import test from 'node:test';
import assert from 'node:assert/strict';
import { captureGenerationCredits, releaseGenerationReservation, refundGenerationReservation } from '../../src/services/generationCreditSettlementService.js';

function poolFor({ generationStatus = 'succeeded', settlementStatus = 'pending', estimatedCost = '10', balance = '0', existingEntries = [] } = {}) {
  const calls = [];
  const generation = { id: 'g1', workspace_id: 'w1', status: generationStatus, settlement_status: settlementStatus, estimated_cost: estimatedCost, reservation_ledger_id: 'reserve-1' };
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (/FROM generation_jobs/.test(text) && /FOR UPDATE/.test(text)) return { rows: [generation] };
      if (/INSERT INTO credit_accounts/.test(text)) return { rows: [{ workspace_id: 'w1', balance }] };
      if (/FROM credit_accounts/.test(text) && /FOR UPDATE/.test(text)) return { rows: [{ workspace_id: 'w1', balance }] };
      if (/FROM credit_ledger/.test(text)) return { rows: existingEntries.filter((entry) => entry.idempotency_key === values[1]) };
      if (/UPDATE credit_accounts/.test(text)) return { rows: [{ workspace_id: 'w1', balance: '7' }] };
      if (/INSERT INTO credit_ledger/.test(text)) return { rows: [{ id: 'settlement-1', amount: values[1], reason: values[3] }] };
      if (/UPDATE generation_jobs/.test(text)) { generation.settlement_status = values[3]; return { rows: [generation] }; }
      return { rows: [] };
    },
    release() {},
  };
  return { calls, async connect() { return client; } };
}

test('captures actual cost once and releases the unused reservation atomically', async () => {
  const pool = poolFor({ estimatedCost: '10', balance: '0' });
  const result = await captureGenerationCredits(pool, { workspaceId: 'w1', generationId: 'g1', actualCost: 7 });
  assert.equal(result.settlement_status, 'captured');
  assert.equal(pool.calls.filter(({ text }) => /INSERT INTO credit_ledger/.test(text)).length, 1);
  assert.equal(pool.calls.at(-1).text, 'COMMIT');
  assert.equal(pool.calls.find(({ text }) => /INSERT INTO credit_ledger/.test(text)).values[1], 3);
  assert.match(pool.calls.find(({ text }) => /INSERT INTO credit_ledger/.test(text)).values[3], /capture/);
});

test('repeated capture is idempotent and does not mutate the ledger again', async () => {
  const pool = poolFor({ settlementStatus: 'captured', existingEntries: [{ idempotency_key: 'generation:settlement:capture:g1' }] });
  const result = await captureGenerationCredits(pool, { workspaceId: 'w1', generationId: 'g1', actualCost: 7 });
  assert.equal(result.settlement_status, 'captured');
  assert.equal(pool.calls.filter(({ text }) => /INSERT INTO credit_ledger/.test(text)).length, 0);
});

test('failed generation releases the reservation and timeout refund is idempotent', async () => {
  const releasePool = poolFor({ generationStatus: 'failed', estimatedCost: '10' });
  await releaseGenerationReservation(releasePool, { workspaceId: 'w1', generationId: 'g1' });
  assert.equal(releasePool.calls.find(({ text }) => /INSERT INTO credit_ledger/.test(text)).values[1], 10);

  const refundPool = poolFor({ generationStatus: 'failed', estimatedCost: '10' });
  const result = await refundGenerationReservation(refundPool, { workspaceId: 'w1', generationId: 'g1' });
  assert.equal(result.settlement_status, 'refunded');
  assert.match(refundPool.calls.find(({ text }) => /INSERT INTO credit_ledger/.test(text)).values[3], /refund/);
});
