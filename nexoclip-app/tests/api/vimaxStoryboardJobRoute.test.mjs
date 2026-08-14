import test from 'node:test';
import assert from 'node:assert/strict';

import { createVimaxStoryboardJobHandler } from '../../app/api/vimax/jobs/route.js';

function request(body) {
  return new Request('http://localhost/api/vimax/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('creates a workspace-authorized durable render job and publishes it after reservation', async () => {
  const calls = [];
  const POST = createVimaxStoryboardJobHandler({
    getSession: async () => ({ user_id: 'user-1' }),
    getWorkspace: async (userId) => {
      calls.push(['workspace', userId]);
      return { id: 'workspace-server-derived' };
    },
    reserve: async (pool, workspaceId, input) => {
      calls.push(['reserve', pool, workspaceId, input]);
      return { id: 'job-1', status: 'queued' };
    },
    publish: async ({ pool }) => calls.push(['publish', pool]),
    pool: { name: 'pool' },
  });

  const response = await POST(request({
    kind: 'vimax_render_video', sessionId: 'session-1', input: {}, idempotencyKey: 'request-1',
  }));

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { id: 'job-1', status: 'queued' });
  assert.deepEqual(calls, [
    ['workspace', 'user-1'],
    ['reserve', { name: 'pool' }, 'workspace-server-derived', {
      kind: 'vimax_render_video', sessionId: 'session-1', input: {}, idempotencyKey: 'request-1',
    }],
    ['publish', { name: 'pool' }],
  ]);
});

test('rejects an unauthenticated submission before workspace or reservation access', async () => {
  let accessed = false;
  const POST = createVimaxStoryboardJobHandler({
    getSession: async () => null,
    getWorkspace: async () => { accessed = true; },
    reserve: async () => { accessed = true; },
    publish: async () => { accessed = true; },
    pool: {},
  });

  const response = await POST(request({ kind: 'vimax_render_video', sessionId: 'session-1', input: {}, idempotencyKey: 'request-1' }));

  assert.equal(response.status, 401);
  assert.equal(accessed, false);
});

test('returns the committed job when immediate publication fails so recovery can publish it', async () => {
  const POST = createVimaxStoryboardJobHandler({
    getSession: async () => ({ user_id: 'user-1' }),
    getWorkspace: async () => ({ id: 'workspace-1' }),
    reserve: async () => ({ id: 'job-1', status: 'queued' }),
    publish: async () => { throw new Error('Redis unavailable'); },
    pool: {},
  });

  const response = await POST(request({ kind: 'vimax_render_video', sessionId: 'session-1', input: {}, idempotencyKey: 'request-1' }));

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { id: 'job-1', status: 'queued' });
});

test('does not publish when durable reservation rejects the request', async () => {
  let published = false;
  const POST = createVimaxStoryboardJobHandler({
    getSession: async () => ({ user_id: 'user-1' }),
    getWorkspace: async () => ({ id: 'workspace-1' }),
    reserve: async () => { throw Object.assign(new Error('Generation rate limit exceeded'), { status: 429 }); },
    publish: async () => { published = true; },
    pool: {},
  });

  const response = await POST(request({ kind: 'vimax_render_video', sessionId: 'session-1', input: {}, idempotencyKey: 'request-1' }));

  assert.equal(response.status, 429);
  assert.equal(published, false);
});
