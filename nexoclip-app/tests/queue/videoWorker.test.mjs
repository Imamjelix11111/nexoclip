import test from 'node:test';
import assert from 'node:assert/strict';

const { videoWorkerConfig } = await import('../../src/queue/videoWorker.mjs');

test('video worker defaults to three concurrent jobs', () => {
  assert.deepEqual(videoWorkerConfig({ REDIS_URL: 'redis://localhost:6379' }), {
    redisUrl: 'redis://localhost:6379', concurrency: 3,
  });
  assert.deepEqual(videoWorkerConfig({ REDIS_URL: 'redis://localhost:6379', VIDEO_WORKER_CONCURRENCY: '3' }), {
    redisUrl: 'redis://localhost:6379', concurrency: 3,
  });
  assert.throws(() => videoWorkerConfig({ REDIS_URL: 'redis://localhost:6379', VIDEO_WORKER_CONCURRENCY: '0' }), /integer between 1 and 8/);
});
