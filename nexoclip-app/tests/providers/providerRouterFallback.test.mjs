import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRouter } from '../../src/providers/providerRouter.js';

test('falls back to Gemini when OpenRouter has no route for a mapped image model', async () => {
  const calls = [];
  const router = createProviderRouter({
    env: { OPENROUTER_API_KEY: 'router-key', GEMINI_API_KEY: 'gemini-key' },
    fetch: async (url) => {
      calls.push(url);
      if (url.startsWith('https://openrouter.ai')) return new Response('', { status: 404 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'cG5n' } }] } }] }), { status: 200 });
    },
  });
  const result = await router.generateImage({ model: 'google/gemini-2.5-flash-image', prompt: 'fox' });
  assert.equal(result.provider, 'google');
  assert.equal(calls.length, 2);
});
