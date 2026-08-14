import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationWorker } from '../../src/queue/generationWorker.js';

function poolFor(job) {
  async function query(text, values) {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (/settlement_status = 'pending'/.test(text)) return { rows: [] };
    if (/SET status = 'running'/.test(text)) { job.status = 'running'; job.attempt_count += 1; return { rows: [job] }; }
    if (text.includes('SET status = $4')) job.status = values[3];
    return { rows: [job] };
  }
  return { query, async connect() { return { query, release() {} }; } };
}

test('passes the provider persistence hook result through successful worker handling', async () => {
  const job = { id: 'g1', workspace_id: 'w1', status: 'queued', attempt_count: 0, max_attempts: 3 };
  let persisted;
  const worker = createGenerationWorker({
    pool: poolFor(job),
    queue: { async dequeue() { return { type: 'generation', generationId: 'g1' }; } },
    pollIntervalMs: 0,
    persistResult: async (result) => { persisted = result; },
    handler: async () => ({ status: 'succeeded', providerRequestId: 'req1', outputs: [{ assetId: 'a1' }], usage: { cost: 0.2 } }),
  });
  await worker.run({ maxMessages: 1 });
  assert.deepEqual(persisted, { workspaceId: 'w1', generationId: 'g1', provider: 'muapi', providerRequestId: 'req1', estimatedCost: null, outputs: [{ assetId: 'a1' }], usage: { cost: 0.2 } });
});
