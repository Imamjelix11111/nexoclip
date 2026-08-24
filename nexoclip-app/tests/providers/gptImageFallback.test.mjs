import test from 'node:test';
import assert from 'node:assert/strict';
import { getDirectProvider } from '../../src/providers/providerRegistry.js';
import { createProviderRouter } from '../../src/providers/providerRouter.js';

test('maps OpenRouter GPT image models to direct OpenAI image models', () => {
  assert.deepEqual(getDirectProvider('openai/gpt-5-image'), { provider: 'openai', model: 'gpt-image-1' });
  assert.deepEqual(getDirectProvider('openai/gpt-5-image-mini'), { provider: 'openai', model: 'gpt-image-1-mini' });
  assert.deepEqual(getDirectProvider('openai/gpt-5.4-image-2'), { provider: 'openai', model: 'gpt-image-2' });
  assert.deepEqual(getDirectProvider('gpt-image-1.5'), { provider: 'openai', model: 'gpt-image-1.5' });
  // A namespaced bare gpt-image id (if OpenRouter ever exposes one) also resolves without renaming the model.
  assert.deepEqual(getDirectProvider('openai/gpt-image-1'), { provider: 'openai', model: 'gpt-image-1' });
  // Non-image GPT chat models stay OpenRouter-only.
  assert.equal(getDirectProvider('openai/gpt-5'), null);
});

test('falls back to direct OpenAI when OpenRouter has no route for the GPT image model', async () => {
  const calls = [];
  const router = createProviderRouter({
    env: { OPENROUTER_API_KEY: 'or-key', OPENAI_API_KEY: 'oa-key' },
    fetch: async (url) => {
      calls.push(url);
      if (url.includes('openrouter.ai')) return { ok: false, status: 400, json: async () => ({ error: { message: 'no route for openai/gpt-5-image' } }) };
      return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: 'abc', mime_type: 'image/png' }] }) };
    },
  });

  const result = await router.generateImage({ model: 'openai/gpt-5-image', prompt: 'a cat' });
  assert.equal(result.provider, 'openai');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /api\.openai\.com\/v1\/images\/generations/);
});

test('reports DIRECT_PROVIDER_UNAVAILABLE when OPENAI_API_KEY is not configured', async () => {
  const router = createProviderRouter({
    env: { OPENROUTER_API_KEY: 'or-key' },
    fetch: async () => ({ ok: false, status: 402, json: async () => ({ error: { message: 'Insufficient credits' } }) }),
  });

  await assert.rejects(router.generateImage({ model: 'openai/gpt-5-image', prompt: 'a cat' }), (error) => {
    assert.equal(error.code, 'DIRECT_PROVIDER_UNAVAILABLE');
    assert.equal(error.provider, 'openai');
    return true;
  });
});
