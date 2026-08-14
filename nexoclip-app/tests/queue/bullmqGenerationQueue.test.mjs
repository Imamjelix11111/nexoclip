import test from 'node:test';
import assert from 'node:assert/strict';
import { createBullMqGenerationQueue } from '../../src/queue/bullmqGenerationQueue.js';

class FakeQueue {
  static added = [];

  constructor(name, options) {
    this.name = name;
    this.options = options;
  }

  async add(name, data, options) {
    FakeQueue.added.push({ name, data, options });
  }

  async close() {}
}

class FakeWorker {}

test('adds a generation message with deterministic BullMQ job id', async () => {
  FakeQueue.added = [];
  const queue = createBullMqGenerationQueue({ Queue: FakeQueue, Worker: FakeWorker, connection: {} });

  await queue.enqueue(
    { type: 'generation', generationId: 'g1', workspaceId: 'w1' },
    { idempotencyKey: 'generation:g1' },
  );

  assert.deepEqual(FakeQueue.added[0], {
    name: 'generation',
    data: { type: 'generation', generationId: 'g1', workspaceId: 'w1' },
    options: { jobId: 'generation:g1', removeOnComplete: true, removeOnFail: false },
  });
});

test('does not expose a polling dequeue method', () => {
  const queue = createBullMqGenerationQueue({ Queue: FakeQueue, Worker: FakeWorker, connection: {} });

  assert.equal('dequeue' in queue, false);
});
