import test from 'node:test';
import assert from 'node:assert/strict';
import { imageWorkerConfig } from '../../src/queue/imageWorker.mjs';

test('image worker defaults to three concurrent jobs', () => {
  assert.deepEqual(imageWorkerConfig({ REDIS_URL: 'redis://localhost:6379' }), {
    redisUrl: 'redis://localhost:6379', concurrency: 3,
  });
  assert.deepEqual(imageWorkerConfig({ REDIS_URL: 'redis://localhost:6379', IMAGE_WORKER_CONCURRENCY: '3' }), {
    redisUrl: 'redis://localhost:6379', concurrency: 3,
  });
  assert.throws(() => imageWorkerConfig({ REDIS_URL: 'redis://localhost:6379', IMAGE_WORKER_CONCURRENCY: '0' }), /integer between 1 and 32/);
});
