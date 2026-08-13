import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transitionGenerationJob,
  failGenerationJob,
  retryGenerationJob,
} from '../../src/repositories/generationStateRepository.js';

function poolFor(row = { id: 'g1', workspace_id: 'w1', status: 'running', attempt_count: 1, max_attempts: 3 }) {
  const calls = [];
  return { calls, async query(text, values) { calls.push({ text, values }); return { rows: [row] }; } };
}

test('transitions a job with workspace scope and timeout metadata', async () => {
  const pool = poolFor();
  await transitionGenerationJob(pool, { workspaceId: 'w1', generationId: 'g1', from: 'running', to: 'processing', timeoutAt: '2026-04-10T00:00:00Z' });
  assert.match(pool.calls[0].text, /workspace_id = \$1/);
  assert.match(pool.calls[0].text, /status = \$4/);
  assert.deepEqual(pool.calls[0].values, ['w1', 'g1', 'running', 'processing', '2026-04-10T00:00:00Z']);
});

test('records retry metadata and returns the job to queued', async () => {
  const pool = poolFor();
  await retryGenerationJob(pool, { workspaceId: 'w1', generationId: 'g1', attempt: 2, nextAttemptAt: '2026-04-10T00:01:00Z', error: { code: 'PROVIDER_UNAVAILABLE', retryable: true } });
  assert.match(pool.calls[0].text, /attempt_count = \$3/);
  assert.match(pool.calls[0].text, /next_attempt_at = \$4/);
  assert.deepEqual(pool.calls[0].values.slice(0, 4), ['w1', 'g1', 2, '2026-04-10T00:01:00Z']);
});

test('marks an exhausted job failed without exposing provider details', async () => {
  const pool = poolFor();
  await failGenerationJob(pool, { workspaceId: 'w1', generationId: 'g1', error: { code: 'PROVIDER_UNAVAILABLE', message: 'safe' } });
  assert.match(pool.calls[0].text, /status = 'failed'/);
  assert.deepEqual(pool.calls[0].values, ['w1', 'g1', '{"code":"PROVIDER_UNAVAILABLE","message":"safe"}']);
});
