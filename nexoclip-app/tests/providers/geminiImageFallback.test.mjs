import test from 'node:test';
import assert from 'node:assert/strict';
import { getDirectProvider } from '../../src/providers/providerRegistry.js';
import { createGoogleImageAdapter } from '../../src/providers/direct/imageAdapters.js';
import { createProviderRouter } from '../../src/providers/providerRouter.js';

test('maps OpenRouter Gemini image model to direct Gemini model', () => {
  assert.deepEqual(getDirectProvider('google/gemini-2.5-flash-image'), {
    provider: 'google',
    model: 'gemini-2.5-flash-image',
  });
});

test('parses Gemini inlineData image response', async () => {
  let request;
  const adapter = createGoogleImageAdapter({
    apiKey: 'secret',
    fetch: async (url, options) => { request = { url, options }; return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'abc123' } }] } }] }),
    }; },
  });
  const result = await adapter.generate({ model: 'gemini-2.5-flash-image', prompt: 'cat', aspectRatio: '16:9', resolution: '1K' });
  assert.match(request.url, /gemini-2\.5-flash-image:generateContent/);
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
  assert.equal(body.generationConfig.aspectRatio, undefined);
  assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio: '16:9', imageSize: '1K' });
  assert.deepEqual(result.outputs, [{ url: 'data:image/png;base64,abc123', mimeType: 'image/png' }]);
});

test('falls back to Gemini when OpenRouter rejects Gemini image access with 403', async () => {
  const calls = [];
  const router = createProviderRouter({
    env: { OPENROUTER_API_KEY: 'or-key', GEMINI_API_KEY: 'gem-key' },
    fetch: async (url) => {
      calls.push(url);
      if (url.includes('openrouter.ai')) return { ok: false, status: 403, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'direct' } }] } }] }) };
    },
  });
  const result = await router.generateImage({ model: 'google/gemini-2.5-flash-image', prompt: 'cat' });
  assert.equal(result.provider, 'google');
  assert.equal(calls.length, 2);
});
