import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueuePublisher } from '../../src/queue/generationQueue.js';
import { completeGenerationJob, recordGenerationProgress, transitionGenerationJob } from '../../src/repositories/generationStateRepository.js';
import { createStoryboardProcessor } from '../../src/queue/storyboardWorker.mjs';

test('expired recovery republishes with a new attempt-specific queue id after a retained failed delivery', async () => {
  const calls = [];
  const client = { async query(text, values) { calls.push({text, values}); if (text === 'BEGIN' || text === 'COMMIT') return {rows: []}; if (/SET queue_claimed_at/.test(text)) return {rows: [{id: 'g1', workspace_id: 'w1', attempt_count: 1, status: 'queued'}]}; return {rows: [{id: 'g1'}]}; }, release() {} };
  const messages = [];
  await createQueuePublisher({pool: {connect: async () => client, query: client.query.bind(client)}, queue: {async enqueue(message, options) { messages.push({message, options}); return {runnable: true}; }}}).publishAvailable();
  assert.deepEqual(messages, [{message: {type: 'generation', generationId: 'g1', workspaceId: 'w1', attempt: 2}, options: {idempotencyKey: 'generation:g1:attempt:2'}}]);
  assert.match(calls.find(({text}) => /queue_published_at = now/.test(text)).text, /attempt_count = \$2/);
});

test('stale claim cannot persist progress, completion, or terminal transition', async () => {
  const calls = [];
  const pool = {async query(text, values) { calls.push({text, values}); return {rows: []}; }};
  const fence = {workspaceId: 'w1', generationId: 'g1', attempt: 1, claimToken: 'old-token'};
  assert.equal(await recordGenerationProgress(pool, {...fence, progress: {stage: 'old'}}), null);
  assert.equal(await completeGenerationJob(pool, {...fence, provider: 'vimax', result: {}}), null);
  assert.equal(await transitionGenerationJob(pool, {...fence, from: 'running', to: 'succeeded'}), null);
  for (const call of calls) {
    assert.match(call.text, /attempt_count = \$[0-9]+/);
    assert.match(call.text, /claim_token = \$[0-9]+/);
  }
});

test('stale completed runtime result does not settle a newer claim', async () => {
  const job = {id: 'g1', workspace_id: 'w1', status: 'queued', attempt_count: 1, max_attempts: 3, reservation_ledger_id: null};
  const calls = [];
  const pool = {
    async connect() { return {async query(text, values) { calls.push({text, values}); if (text === 'BEGIN' || text === 'COMMIT') return {rows: []}; if (/SET status = 'running'/.test(text)) return {rows: [{...job, attempt_count: 2, claim_token: 'new-token'}]}; return {rows: []}; }, release() {}}; },
    async query(text, values) { calls.push({text, values}); return {rows: []}; },
  };
  let settled = 0;
  const processor = createStoryboardProcessor({pool, runtimeClient: {execute: async () => ({ok: true, result: {}})}, settleUnreserved: async () => { settled += 1; }, onError: () => {}});
  assert.equal(await processor({type: 'generation', generationId: 'g1', workspaceId: 'w1', attempt: 2}), false);
  assert.equal(settled, 0);
});

test('completion stores runtime artifacts and leaves absent provider request id null', async () => {
  const calls = [];
  const pool = {async query(text, values) { calls.push({text, values}); return {rows: [{id: 'g1'}]}; }};
  await completeGenerationJob(pool, {workspaceId: 'w1', generationId: 'g1', attempt: 1, claimToken: 'token', provider: 'vimax', result: {artifacts: [{path: 'w1/video/final.mp4', kind: 'video', name: 'final.mp4'}]}});
  const call = calls[0];
  assert.match(call.text, /provider = COALESCE/);
  assert.doesNotMatch(call.text.split('RETURNING')[0], /provider_request_id/);
  assert.match(call.values[2], /final\.mp4/);
});
