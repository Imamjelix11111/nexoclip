import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageHandler } from '../../app/api/openrouter/images/route.js';

function postReq(body) {
  const r = new Request('http://app/api/openrouter/images', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
    body: JSON.stringify(body),
  });
  r.cookies = { get: (n) => (n === 'nexoclip_session' ? { value: 'tok' } : undefined) };
  return r;
}

test('a successful image generation creates a succeeded image job with the display contract', async () => {
  let created; let updated;
  const handler = createImageHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }),
    env: { OPENROUTER_API_KEY: 'k' },
    generate: async () => ({ outputs: [{ url: 'data:image/png;base64,AAAA', mimeType: 'image/png' }] }),
    persist: async () => ({ id: 'asset-1', url: 'https://assets/x.png' }),
    createJob: async ({ workspaceId, kind }) => { created = { workspaceId, kind }; return { id: 'job-1', status: 'queued' }; },
    updateJobStatus: async (args) => { updated = args; return { id: 'job-1', status: 'succeeded' }; },
  });
  const res = await handler(postReq({ model: 'nano-banana', prompt: 'a cat' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.job_id, 'job-1');
  assert.deepEqual(created, { workspaceId: 'ws-1', kind: 'image' });
  assert.equal(updated.status, 'succeeded');
  assert.equal(updated.result.kind, 'image');
  assert.equal(updated.result.outputUrl, 'https://assets/x.png');
});

test('missing model/prompt is 400 before any job is created', async () => {
  let calls = 0;
  const handler = createImageHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }), env: { OPENROUTER_API_KEY: 'k' },
    generate: async () => ({ outputs: [] }), persist: async () => ({}),
    createJob: async () => { calls += 1; return { id: 'j' }; }, updateJobStatus: async () => ({}),
  });
  const res = await handler(postReq({ prompt: 'no model' }));
  assert.equal(res.status, 400);
  assert.equal(calls, 0);
});
