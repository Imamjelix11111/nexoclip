import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRouter } from '../../src/providers/providerRouter.js';

const env = {
  BYTEPLUS_API_KEY: 'byteplus-key',
  BYTEPLUS_BASE_URL: 'https://ark.example/api/v3',
  BYTEPLUS_SEEDANCE_2_ENDPOINT: 'ep-video-20',
  BYTEPLUS_SEEDANCE_2_5_ENDPOINT: 'ep-video-25',
  BYTEPLUS_SEEDREAM_5_ENDPOINT: 'ep-image-50',
};

test('routes dedicated Seedance aliases directly to the video endpoint id', async () => {
  const calls = [];
  const router = createProviderRouter({ env, fetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: 'task-1', status: 'queued' }), { status: 200 });
  } });

  await router.submitVideo({ model: 'byteplus/seedance-2.0-unfiltered', prompt: 'scene' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ark.example/api/v3/contents/generations/tasks');
  assert.equal(calls[0].body.model, 'ep-video-20');
});

test('routes dedicated Seedream alias directly to the image endpoint id', async () => {
  const calls = [];
  const router = createProviderRouter({ env, fetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ data: [{ url: 'https://output.example/image.png' }] }), { status: 200 });
  } });

  await router.generateImage({ model: 'byteplus/seedream-5.0-pro-unfiltered', prompt: 'portrait' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ark.example/api/v3/images/generations');
  assert.equal(calls[0].body.model, 'ep-image-50');
});

test('does not call OpenRouter or a base model when endpoint configuration is absent', async () => {
  let calls = 0;
  const router = createProviderRouter({
    env: { BYTEPLUS_API_KEY: 'key', BYTEPLUS_BASE_URL: 'https://ark.example/api/v3' },
    fetch: async () => { calls += 1; return new Response('{}', { status: 200 }); },
  });
  await assert.rejects(
    router.submitVideo({ model: 'byteplus/seedance-2.5-unfiltered', prompt: 'scene' }),
    (error) => error.code === 'BYTEPLUS_ENDPOINT_NOT_CONFIGURED',
  );
  assert.equal(calls, 0);
});
