import test from 'node:test';
import assert from 'node:assert/strict';
import { generationQueueName } from '../../src/queue/generationQueue.js';

test('uses isolated BullMQ queues for image and video jobs', () => {
  assert.equal(generationQueueName('image'), 'generation-image');
  assert.equal(generationQueueName('video'), 'generation-video');
  assert.throws(() => generationQueueName('audio'), /Unsupported generation queue kind/);
});
