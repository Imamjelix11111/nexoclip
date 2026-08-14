import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryboardWorker, workerConfig } from '../../src/queue/storyboardWorker.mjs';

test('rejects missing required worker configuration without exposing values', () => {
  assert.throws(
    () => workerConfig({ REDIS_URL: 'redis://secret@redis', VIMAX_RUNTIME_URL: 'http://runtime' }),
    (error) => error.message === 'VIMAX_RUNTIME_TOKEN is required' && !error.message.includes('secret'),
  );
});

test('pauses BullMQ consumption before closing worker, queue, and pool', async () => {
  const calls = [];
  const worker = await createStoryboardWorker({
    env: { REDIS_URL: 'redis://redis', VIMAX_RUNTIME_URL: 'http://runtime', VIMAX_RUNTIME_TOKEN: 'token' },
    getPool: () => ({ end: async () => calls.push('pool.close') }),
    closePool: async () => calls.push('pool.closeSingleton'),
    Redis: class { async quit() { calls.push('redis.close'); } },
    createRuntimeClient: () => ({ execute: async () => ({ ok: true }) }),
    createQueue: () => ({
      createWorker: () => ({ pause: async () => calls.push('worker.pause'), close: async () => calls.push('worker.close') }),
      close: async () => calls.push('queue.close'),
    }),
    recoverQueuedGenerations: async () => calls.push('recover'),
    setInterval: () => ({ unref() {}, clear() {} }),
    clearInterval: () => {},
  });

  await worker.close();

  assert.deepEqual(calls, ['recover', 'worker.pause', 'worker.close', 'queue.close', 'redis.close', 'pool.closeSingleton']);
});
