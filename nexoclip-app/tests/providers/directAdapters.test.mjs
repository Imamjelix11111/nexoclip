import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIAdapter } from '../../src/providers/direct/openaiAdapter.js';
import { createBytePlusAdapter } from '../../src/providers/direct/byteplusAdapter.js';
import { createGeminiAdapter } from '../../src/providers/direct/geminiAdapter.js';

function response(body, { status = 200, headers = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (key) => headers[key.toLowerCase()] || null }, json: async () => body };
}

test('OpenAI direct adapter sends OpenAI-compatible chat request', async () => {
  let request;
  const adapter = createOpenAIAdapter({ apiKey: 'secret', fetch: async (url, options) => { request = { url, options }; return response({ choices: [{ message: { content: 'ok' } }] }); } });
  const result = await adapter.generate({ model: 'gpt-4o', prompt: 'hello' });
  assert.equal(result.output, 'ok');
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(request.options.body), { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] });
});

test('BytePlus adapter uses configured base URL and model', async () => {
  let request;
  const adapter = createBytePlusAdapter({ apiKey: 'secret', baseUrl: 'https://ark.example/api/v3/', fetch: async (url, options) => { request = { url, options }; return response({ choices: [{ message: { content: 'ok' } }] }); } });
  await adapter.generate({ model: 'seedance-1-0', prompt: 'hello' });
  assert.equal(request.url, 'https://ark.example/api/v3/chat/completions');
  assert.match(request.options.headers.Authorization, /^Bearer /);
  assert.equal(JSON.parse(request.options.body).model, 'seedance-1-0');
});

test('Gemini adapter uses API key without exposing it in errors', async () => {
  let request;
  const adapter = createGeminiAdapter({ apiKey: 'secret', fetch: async (url, options) => { request = { url, options }; return response({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }); } });
  const result = await adapter.generate({ model: 'gemini-2.5-pro', prompt: 'hello' });
  assert.equal(result.output, 'ok');
  assert.match(request.url, /models\/gemini-2\.5-pro:generateContent\?key=secret$/);
  assert.equal(JSON.parse(request.options.body).contents[0].parts[0].text, 'hello');
});
