import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationWorker } from '../../src/queue/generationWorker.js';

function workerPool(jobs) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      const client = await this.connect();
      try { return await client.query(text, values); } finally { client.release(); }
    },
    async connect() {
      return {
        async query(text, values) {
          calls.push({ text, values });
          if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
          if (/SET status = 'running'/.test(text)) {
            const job = jobs.find((candidate) => candidate.id === values[0] && candidate.status === 'queued');
            if (!job) return { rows: [] };
            job.status = 'running';
            return { rows: [job] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
}

function queueFor(messages) {
  return {
    async dequeue() {
      return messages.shift() || null;
    },
  };
}

test('claims each queued generation once before invoking the handler', async () => {
  const jobs = [{ id: 'g1', status: 'queued', workspace_id: 'w1' }];
  const pool = workerPool(jobs);
  const messages = [{ type: 'generation', generationId: 'g1', workspaceId: 'w1' }, { type: 'generation', generationId: 'g1', workspaceId: 'w1' }];
  const handled = [];
  const worker = createGenerationWorker({
    pool,
    queue: queueFor(messages),
    concurrency: 1,
    pollIntervalMs: 0,
    handler: async (job) => handled.push(job.id),
  });

  await worker.run({ maxMessages: 2 });

  assert.deepEqual(handled, ['g1']);
  assert.equal(jobs[0].status, 'running');
  assert.equal(pool.calls.filter(({ text }) => /SET status = 'running'/.test(text)).length, 2);
});

test('polls while idle until stopped', async () => {
  let polls = 0;
  const worker = createGenerationWorker({
    pool: workerPool([]),
    queue: { async dequeue() { polls += 1; return null; } },
    pollIntervalMs: 1,
    handler: async () => {},
  });

  const running = worker.run();
  await new Promise((resolve) => setTimeout(resolve, 4));
  worker.stop();
  await running;

  assert.ok(polls >= 2);
});

test('does not exceed configured concurrency and stops gracefully', async () => {
  const jobs = [1, 2, 3].map((id) => ({ id: `g${id}`, status: 'queued', workspace_id: 'w1' }));
  const active = [];
  let peak = 0;
  const worker = createGenerationWorker({
    pool: workerPool(jobs),
    queue: queueFor(jobs.map((job) => ({ type: 'generation', generationId: job.id, workspaceId: job.workspace_id }))),
    concurrency: 2,
    pollIntervalMs: 0,
    handler: async (job) => {
      active.push(job.id);
      peak = Math.max(peak, active.length);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active.splice(active.indexOf(job.id), 1);
    },
  });

  const running = worker.run({ maxMessages: 3 });
  await new Promise((resolve) => setTimeout(resolve, 1));
  worker.stop();
  await running;

  assert.equal(peak, 2);
  assert.equal(active.length, 0);
});
