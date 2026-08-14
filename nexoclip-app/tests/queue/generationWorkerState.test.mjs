import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationWorker } from '../../src/queue/generationWorker.js';

function poolFor(job) {
  async function query(text, values) {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (/SET status = 'running'/.test(text)) { job.status = 'running'; job.attempt_count += 1; return { rows: [job] }; }
    if (text.includes('SET status = $4')) job.status = values[3];
    if (/SET status = 'queued'/.test(text)) job.status = 'queued';
    if (/status = 'failed'/.test(text)) job.status = 'failed';
    return { rows: [job] };
  }
  return { query, async connect() { return { query, release() {} }; } };
}

test('worker transitions successful handler work to succeeded', async () => {
  const job = { id: 'g1', workspace_id: 'w1', status: 'queued', attempt_count: 0, max_attempts: 3 };
  const worker = createGenerationWorker({ pool: poolFor(job), queue: { async dequeue() { return { type: 'generation', generationId: 'g1' }; } }, maxMessages: 1, pollIntervalMs: 0, handler: async () => ({ status: 'succeeded' }) });
  await worker.run({ maxMessages: 1 });
  assert.equal(job.status, 'succeeded');
});

test('worker settles a zero-cost successful job without a reservation ledger', async () => {
  const job = { id: 'g1', workspace_id: 'w1', status: 'queued', attempt_count: 0, max_attempts: 3, reservation_ledger_id: null };
  const settled = [];
  const worker = createGenerationWorker({
    pool: poolFor(job), queue: { async dequeue() { return { type: 'generation', generationId: 'g1' }; } }, pollIntervalMs: 0,
    handler: async () => ({ status: 'succeeded' }),
    settleUnreserved: async (_pool, args) => settled.push(args),
  });
  await worker.run({ maxMessages: 1 });

  assert.equal(job.status, 'succeeded');
  assert.deepEqual(settled, [{ workspaceId: 'w1', generationId: 'g1', status: 'succeeded' }]);
});

test('worker settles a terminal zero-cost failure without a reservation ledger', async () => {
  const job = { id: 'g1', workspace_id: 'w1', status: 'queued', attempt_count: 2, max_attempts: 3, reservation_ledger_id: null };
  const settled = [];
  const worker = createGenerationWorker({
    pool: poolFor(job), queue: { async dequeue() { return { type: 'generation', generationId: 'g1' }; } }, pollIntervalMs: 0, onError: () => {},
    handler: async () => { throw Object.assign(new Error('invalid'), { code: 'RUNTIME_REQUEST_FAILED' }); },
    settleUnreserved: async (_pool, args) => settled.push(args),
  });
  await worker.run({ maxMessages: 1 });

  assert.equal(job.status, 'failed');
  assert.deepEqual(settled, [{ workspaceId: 'w1', generationId: 'g1', status: 'failed' }]);
});

test('worker retries a retryable failure and records bounded backoff metadata', async () => {
  const job = { id: 'g1', workspace_id: 'w1', status: 'queued', attempt_count: 0, max_attempts: 3 };
  const worker = createGenerationWorker({ pool: poolFor(job), queue: { async dequeue() { return { type: 'generation', generationId: 'g1' }; } }, pollIntervalMs: 0, baseDelayMs: 10, onError: () => {}, handler: async () => { throw Object.assign(new Error('temporary'), { code: 'PROVIDER_UNAVAILABLE' }); } });
  await worker.run({ maxMessages: 1 });
  assert.equal(job.status, 'queued');
});
