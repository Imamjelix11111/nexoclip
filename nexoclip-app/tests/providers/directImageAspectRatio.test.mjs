import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIImageAdapter, createBytePlusImageAdapter, createGoogleImageAdapter } from '../../src/providers/direct/imageAdapters.js';

function response(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('OpenAI maps the studio aspect ratio to a supported image size', async () => {
  let request;
  const adapter = createOpenAIImageAdapter({ apiKey: 'key', fetch: async (_url, init) => {
    request = JSON.parse(init.body);
    return response({ data: [{ b64_json: Buffer.from('image').toString('base64') }] });
  } });

  await adapter.generate({ model: 'gpt-image-2', prompt: 'portrait', aspectRatio: '9:16' });
  assert.equal(request.size, '1024x1536');
});

test('BytePlus maps the studio aspect ratio to an explicit provider size', async () => {
  let request;
  const adapter = createBytePlusImageAdapter({ apiKey: 'key', baseUrl: 'https://byteplus.test', fetch: async (_url, init) => {
    request = JSON.parse(init.body);
    return response({ data: [{ url: 'https://image.test/output.png' }] });
  } });

  await adapter.generate({ model: 'seedream-4-5-251128', prompt: 'landscape', aspectRatio: '16:9', resolution: '2K' });
  assert.equal(request.size, '3072x1728');
});

test('BytePlus uses a provider-valid minimum pixel count for portrait ratios', async () => {
  let request;
  const adapter = createBytePlusImageAdapter({ apiKey: 'key', baseUrl: 'https://byteplus.test', fetch: async (_url, init) => {
    request = JSON.parse(init.body);
    return response({ data: [{ url: 'https://image.test/output.png' }] });
  } });

  await adapter.generate({ model: 'seedream-4-5-251128', prompt: 'portrait', aspectRatio: '9:16' });
  assert.equal(request.size, '1728x3072');
});

test('Gemini preserves the studio aspect ratio in imageConfig', async () => {
  let request;
  const adapter = createGoogleImageAdapter({ apiKey: 'key', baseUrl: 'https://gemini.test', fetch: async (_url, init) => {
    request = JSON.parse(init.body);
    return response({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('image').toString('base64') } }] } }] });
  } });

  await adapter.generate({ model: 'gemini-3-pro-image', prompt: 'square', aspectRatio: '1:1', resolution: '1K' });
  assert.deepEqual(request.generationConfig.imageConfig, { aspectRatio: '1:1', imageSize: '1K' });
});
