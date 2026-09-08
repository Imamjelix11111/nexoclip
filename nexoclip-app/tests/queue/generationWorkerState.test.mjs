import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationWorker } from '../../src/queue/generationWorker.js';

function poolFor(job) {
  async function query(text, values) {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (/settlement_status = 'pending'/.test(text)) return { rows: [] };
    if (/SET status = 'running'/.test(text)) { job.status = 'running'; job.attempt_count += 1; return { rows: [job] }; }
    if (text.includes('SET status = $4')) job.status = values[3];
    if (/SET status = 'queued'/.test(text)) job.status = 'queued';
    if (/status = 'failed'/.test(text) && ['running', 'processing'].includes(job.status)) job.status = 'failed';
    return { rows: [job] };
  }
  return { calls: [], async query(text, values) { this.calls.push({ text, values }); return query(text, values); }, async connect() { return { query: async (text, values) => { this.calls.push({ text, values }); return query(text, values); }, release() {} }; } };
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

test('startup recovers a succeeded job when immediate unreserved settlement fails', async () => {
  const job = { id: 'g1', workspace_id: 'w1', status: 'queued', settlement_status: 'pending', attempt_count: 0, max_attempts: 3, reservation_ledger_id: null };
  const failedSettlements = [];
  const firstWorker = createGenerationWorker({
    pool: poolFor(job),
    queue: { async dequeue() { return { type: 'generation', generationId: 'g1' }; } },
    pollIntervalMs: 0,
    handler: async () => ({ status: 'succeeded' }),
    settleUnreserved: async (_pool, args) => { failedSettlements.push(args); throw new Error('settlement unavailable'); },
    recoverUnreserved: async () => {},
  });

  await firstWorker.run({ maxMessages: 1 });
  assert.equal(job.status, 'succeeded');
  assert.equal(job.settlement_status, 'pending');

  let executions = 0;
  const recoveryWorker = createGenerationWorker({
    pool: poolFor(job),
    queue: { async dequeue() { return null; } },
    pollIntervalMs: 0,
    handler: async () => { executions += 1; },
    recoverUnreserved: async () => { job.settlement_status = 'captured'; },
  });
  await recoveryWorker.run({ maxMessages: 0 });

  assert.deepEqual(failedSettlements, [
    { workspaceId: 'w1', generationId: 'g1', status: 'succeeded' },
  ]);
  assert.equal(job.settlement_status, 'captured');
  assert.equal(executions, 0);
});

test('startup recovers a failed job when immediate unreserved settlement fails', async () => {
  const job = { id: 'g1', workspace_id: 'w1', status: 'queued', settlement_status: 'pending', attempt_count: 2, max_attempts: 3, reservation_ledger_id: null };
  const firstWorker = createGenerationWorker({
    pool: poolFor(job),
    queue: { async dequeue() { return { type: 'generation', generationId: 'g1' }; } },
    pollIntervalMs: 0,
    onError: () => {},
    handler: async () => { throw Object.assign(new Error('invalid'), { code: 'RUNTIME_REQUEST_FAILED' }); },
    settleUnreserved: async () => { throw new Error('settlement unavailable'); },
    recoverUnreserved: async () => {},
  });

  await firstWorker.run({ maxMessages: 1 });
  assert.equal(job.status, 'failed');
  assert.equal(job.settlement_status, 'pending');

  const recoveryWorker = createGenerationWorker({
    pool: poolFor(job),
    queue: { async dequeue() { return null; } },
    pollIntervalMs: 0,
    handler: async () => { throw new Error('provider must not run'); },
    recoverUnreserved: async () => { job.settlement_status = 'released'; },
  });
  await recoveryWorker.run({ maxMessages: 0 });

  assert.equal(job.settlement_status, 'released');
});

test('worker startup recovers a pending terminal unreserved settlement without executing a provider', async () => {
  const job = { id: 'g1', workspace_id: 'w1', status: 'succeeded', attempt_count: 1, max_attempts: 3, reservation_ledger_id: null };
  let executions = 0;
  let recoveries = 0;
  const worker = createGenerationWorker({
    pool: poolFor(job),
    queue: { async dequeue() { return null; } },
    pollIntervalMs: 0,
    handler: async () => { executions += 1; },
    recoverUnreserved: async () => { recoveries += 1; },
  });

  await worker.run({ maxMessages: 0 });

  assert.equal(recoveries, 1);
  assert.equal(executions, 0);
});

test('worker stores a safe provider failure message for the client', async () => {
  const job = { id: 'g1', workspace_id: 'w1', status: 'queued', attempt_count: 2, max_attempts: 3, reservation_ledger_id: null };
  const pool = poolFor(job);
  await createGenerationWorker({
    pool, queue: { async dequeue() { return { type: 'generation', generationId: 'g1' }; } }, pollIntervalMs: 0, onError: () => {},
    handler: async () => { throw Object.assign(new Error('Google image request failed: quota exceeded'), { code: 'GOOGLE_IMAGE_FAILED' }); },
  }).run({ maxMessages: 1 });
  const failure = pool.calls?.find?.(({ text }) => text.includes("SET status = 'failed'"));
  assert.ok(failure?.values?.[2].includes('Image generation failed. Please retry'));
  assert.ok(!failure?.values?.[2].includes('quota exceeded'));
});

test('worker retries a retryable failure and records bounded backoff metadata', async () => {
  const job = { id: 'g1', workspace_id: 'w1', status: 'queued', attempt_count: 0, max_attempts: 3 };
  const worker = createGenerationWorker({ pool: poolFor(job), queue: { async dequeue() { return { type: 'generation', generationId: 'g1' }; } }, pollIntervalMs: 0, baseDelayMs: 10, onError: () => {}, handler: async () => { throw Object.assign(new Error('temporary'), { code: 'PROVIDER_UNAVAILABLE' }); } });
  await worker.run({ maxMessages: 1 });
  assert.equal(job.status, 'queued');
});
