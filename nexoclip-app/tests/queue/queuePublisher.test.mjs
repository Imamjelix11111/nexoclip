import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueuePublisher, recoverQueuedGenerations } from '../../src/queue/generationQueue.js';

function poolFor(rows) {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (/SET queue_claimed_at = now\(\)/.test(text)) return { rows };
      if (/queue_published_at = now\(\)/.test(text)) return { rows: [{ id: values[0] }] };
      if (/queue_claimed_at = NULL/.test(text)) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  return { calls, async connect() { return client; }, async query(text, values) { return client.query(text, values); } };
}

test('publishes a claimed generation after it is committed and uses a stable idempotency key', async () => {
  const pool = poolFor([{ id: 'g1', workspace_id: 'w1', status: 'queued' }]);
  const messages = [];
  const queue = { async enqueue(message, options) { messages.push({ message, options }); } };

  const published = await createQueuePublisher({ pool, queue }).publishAvailable();

  assert.equal(published, 1);
  assert.deepEqual(messages, [{
    message: { type: 'generation', generationId: 'g1', workspaceId: 'w1' },
    options: { idempotencyKey: 'generation:g1' },
  }]);
  assert.equal(pool.calls[0].text, 'BEGIN');
  assert.equal(pool.calls.findIndex((call) => call.text === 'COMMIT') > pool.calls.findIndex((call) => /SET queue_claimed_at = now/.test(call.text)), true);
  assert.match(pool.calls.find((call) => /queue_published_at = now/.test(call.text)).text, /WHERE id = \$1/);
});

test('claims a due retry even if it was published before', async () => {
  const pool = poolFor([]);
  const publisher = createQueuePublisher({ pool, queue: { async enqueue() {} } });

  await publisher.publishAvailable();

  assert.match(pool.calls.find((call) => /UPDATE generation_jobs/.test(call.text)).text,
    /\(next_attempt_at IS NULL OR next_attempt_at <= now\(\)\)/);
});

test('recovery publishes queued jobs and releases a failed claim', async () => {
  const pool = poolFor([{ id: 'g2', workspace_id: 'w2', status: 'queued' }]);
  const queue = { async enqueue() { throw new Error('queue unavailable'); } };

  await assert.rejects(recoverQueuedGenerations({ pool, queue }), /queue unavailable/);
  assert.equal(pool.calls.findIndex((call) => /queue_claimed_at = NULL/.test(call.text)) > pool.calls.findIndex((call) => /SET queue_claimed_at = now/.test(call.text)), true);
  assert.match(pool.calls.find((call) => /queue_claimed_at = NULL/.test(call.text)).text, /queue_published_at IS NULL/);
});
