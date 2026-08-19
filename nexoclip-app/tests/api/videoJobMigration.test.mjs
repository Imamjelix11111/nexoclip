import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoSubmitHandler } from '../../app/api/openrouter/videos/route.js';

function postReq(body) {
  const r = new Request('http://app/api/openrouter/videos', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
    body: JSON.stringify(body),
  });
  r.cookies = { get: (n) => (n === 'nexoclip_session' ? { value: 'tok' } : undefined) };
  return r;
}

test('submitting a video creates a durable video job and returns its id', async () => {
  let created;
  const handler = createVideoSubmitHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }),
    env: { OPENROUTER_API_KEY: 'k' },
    submitVideo: async () => ({ id: 'or-1', polling_url: 'p', status: 'pending' }),
    createJob: async ({ workspaceId, kind }) => {
      created = { workspaceId, kind };
      return { id: 'job-1', status: 'queued' };
    },
  });
  const res = await handler(postReq({ model: 'google/veo-3.1', prompt: 'a cat' }));
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.job_id, 'job-1');
  assert.deepEqual(created, { workspaceId: 'ws-1', kind: 'video' });
});

test('missing model/prompt is 400 before any job is created', async () => {
  let calls = 0;
  const handler = createVideoSubmitHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }),
    env: { OPENROUTER_API_KEY: 'k' },
    submitVideo: async () => ({ id: 'x' }),
    createJob: async () => { calls += 1; return { id: 'j' }; },
  });
  const res = await handler(postReq({ prompt: 'no model' }));
  assert.equal(res.status, 400);
  assert.equal(calls, 0);
});
