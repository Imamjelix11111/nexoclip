import test from 'node:test';
import assert from 'node:assert/strict';
import { createClipSubmitHandler } from '../../app/api/ai-clip/jobs/route.js';

function postReq(body) {
  const r = new Request('http://app/api/ai-clip/jobs', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
    body: JSON.stringify(body),
  });
  r.cookies = { get: (n) => (n === 'nexoclip_session' ? { value: 'tok' } : undefined) };
  return r;
}

test('submitting a clip job creates a durable clipping job and returns its id', async () => {
  let created;
  const handler = createClipSubmitHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }),
    env: { AI_CLIP_RUNTIME_URL: 'http://clip', AI_CLIP_RUNTIME_TOKEN: 'secret' },
    submitClip: async () => ({ id: 'py-1', status: 'pending' }),
    createJob: async ({ workspaceId, kind }) => { created = { workspaceId, kind }; return { id: 'job-1', status: 'queued' }; },
  });
  const res = await handler(postReq({ video_url: 'https://v/x.mp4' }));
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.job_id, 'job-1');
  assert.equal(body.id, 'py-1');
  assert.deepEqual(created, { workspaceId: 'ws-1', kind: 'clipping' });
});

test('missing video_url is 400 before any job is created', async () => {
  let calls = 0;
  const handler = createClipSubmitHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }),
    env: { AI_CLIP_RUNTIME_URL: 'http://clip', AI_CLIP_RUNTIME_TOKEN: 'secret' },
    submitClip: async () => ({ id: 'py' }), createJob: async () => { calls += 1; return { id: 'j' }; },
  });
  const res = await handler(postReq({}));
  assert.equal(res.status, 400);
  assert.equal(calls, 0);
});
