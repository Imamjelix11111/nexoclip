import test from 'node:test';
import assert from 'node:assert/strict';
import { getDirectProvider } from '../../src/providers/providerRegistry.js';
import { createOpenAIVideoAdapter } from '../../src/providers/direct/openaiVideoAdapter.js';
import { createProviderRouter } from '../../src/providers/providerRouter.js';

function jsonResponse(body, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body };
}

test('maps OpenRouter Sora 2 Pro to the direct OpenAI video model', () => {
  assert.deepEqual(getDirectProvider('openai/sora-2-pro'), { provider: 'openai', model: 'sora-2-pro' });
});

test('OpenAI video adapter sends a single input_reference, not a list', async () => {
  let request;
  const adapter = createOpenAIVideoAdapter({
    apiKey: 'oa-key',
    fetch: async (url, options) => { request = { url, options }; return jsonResponse({ id: 'video_1', status: 'queued' }); },
  });
  const result = await adapter.submit({
    model: 'sora-2-pro', prompt: 'a woman waving', duration: 8, aspectRatio: '9:16',
    referenceImages: ['https://cdn.example.com/ref.jpg'],
  });
  assert.equal(request.url, 'https://api.openai.com/v1/videos');
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.input_reference, { image_url: 'https://cdn.example.com/ref.jpg' });
  assert.equal(body.seconds, '8');
  assert.equal(body.size, '720x1280');
  assert.equal(result.provider, 'openai');
});

test('OpenAI video adapter poll/download hit /videos/{id} and /videos/{id}/content', async () => {
  const calls = [];
  const adapter = createOpenAIVideoAdapter({
    apiKey: 'oa-key',
    fetch: async (url) => {
      calls.push(url);
      if (url.endsWith('/content')) return { ok: true, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => new TextEncoder().encode('bytes').buffer };
      return jsonResponse({ id: 'video_1', status: 'completed' });
    },
  });
  const status = await adapter.poll('video_1');
  assert.equal(status.status, 'completed');
  const { buffer, contentType } = await adapter.downloadContent('video_1');
  assert.equal(contentType, 'video/mp4');
  assert.equal(buffer.toString(), 'bytes');
  assert.deepEqual(calls, ['https://api.openai.com/v1/videos/video_1', 'https://api.openai.com/v1/videos/video_1/content']);
});

test('falls back to direct OpenAI when OpenRouter rejects Sora 2 Pro with 403', async () => {
  const calls = [];
  const router = createProviderRouter({
    env: { OPENROUTER_API_KEY: 'or-key', OPENAI_API_KEY: 'oa-key' },
    fetch: async (url) => {
      calls.push(url);
      if (url.includes('openrouter.ai')) return { ok: false, status: 403, json: async () => ({}) };
      return jsonResponse({ id: 'video_1', status: 'queued' });
    },
  });
  const result = await router.submitVideo({ model: 'openai/sora-2-pro', prompt: 'a woman waving', referenceImages: ['https://cdn.example.com/ref.jpg'] });
  assert.equal(result.provider, 'openai');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /api\.openai\.com\/v1\/videos$/);
});

test('poll and download route to the direct OpenAI adapter once a job is tagged provider: openai', async () => {
  const calls = [];
  const router = createProviderRouter({
    env: { OPENAI_API_KEY: 'oa-key' },
    fetch: async (url) => {
      calls.push(url);
      if (url.endsWith('/content')) return { ok: true, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => new TextEncoder().encode('bytes').buffer };
      return jsonResponse({ id: 'video_1', status: 'completed' });
    },
  });
  const status = await router.pollVideo('openai', 'video_1');
  assert.equal(status.status, 'completed');
  const { contentType } = await router.downloadVideo('openai', 'video_1', 0);
  assert.equal(contentType, 'video/mp4');
});
