import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRouter } from '../../src/providers/providerRouter.js';

test('pollVideo normalizes BytePlus "succeeded" to the OpenRouter-vocabulary "completed" the poll route checks for', async () => {
  const router = createProviderRouter({
    env: { BYTEPLUS_API_KEY: 'bp-key', BYTEPLUS_BASE_URL: 'https://ark.example/api/v3' },
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ id: 'cgt-1', status: 'succeeded', content: { video_url: 'https://tos.example/out.mp4' } }) }),
  });
  const status = await router.pollVideo('byteplus', 'cgt-1');
  assert.equal(status.status, 'completed');
  assert.equal(status.content.video_url, 'https://tos.example/out.mp4');
});

test('pollVideo leaves non-terminal BytePlus statuses (running/queued) untouched', async () => {
  const router = createProviderRouter({
    env: { BYTEPLUS_API_KEY: 'bp-key', BYTEPLUS_BASE_URL: 'https://ark.example/api/v3' },
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ id: 'cgt-1', status: 'running' }) }),
  });
  const status = await router.pollVideo('byteplus', 'cgt-1');
  assert.equal(status.status, 'running');
});

test('pollVideo exposes a readable BytePlus failure instead of [object Object]', async () => {
  const router = createProviderRouter({
    env: { BYTEPLUS_API_KEY: 'bp-key', BYTEPLUS_BASE_URL: 'https://ark.example/api/v3' },
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        id: 'cgt-1',
        status: 'failed',
        error: { code: 'QuotaExceeded', message: 'Free trial quota exhausted' },
      }),
    }),
  });

  const status = await router.pollVideo('byteplus', 'cgt-1');

  assert.equal(status.status, 'failed');
  assert.equal(status.error, 'Free trial quota exhausted');
  assert.equal(status.error_code, 'QuotaExceeded');
});
