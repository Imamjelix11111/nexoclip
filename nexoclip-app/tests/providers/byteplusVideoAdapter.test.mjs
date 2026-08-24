import test from 'node:test';
import assert from 'node:assert/strict';
import { createBytePlusAdapter } from '../../src/providers/direct/byteplusAdapter.js';

function jsonResponse(body, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body };
}

test('submit posts to the async /tasks endpoint, not /contents/generations', async () => {
  let request;
  const adapter = createBytePlusAdapter({
    apiKey: 'secret', baseUrl: 'https://ark.example/api/v3',
    fetch: async (url, options) => { request = { url, options }; return jsonResponse({ id: 'cgt-1' }); },
  });
  await adapter.submit({ model: 'dreamina-seedance-2-0-260128', prompt: 'a cat' });
  assert.equal(request.url, 'https://ark.example/api/v3/contents/generations/tasks');
});

test('submit sends reference videos with the reference_video role BytePlus requires', async () => {
  let request;
  const adapter = createBytePlusAdapter({
    apiKey: 'secret', baseUrl: 'https://ark.example/api/v3',
    fetch: async (url, options) => { request = { url, options }; return jsonResponse({ id: 'cgt-1' }); },
  });
  await adapter.submit({ model: 'dreamina-seedance-2-0-260128', prompt: 'remove watermark', referenceVideos: ['https://cdn.example/in.mp4'] });
  const body = JSON.parse(request.options.body);
  assert.deepEqual(
    body.content.find((part) => part.type === 'video_url'),
    { type: 'video_url', role: 'reference_video', video_url: { url: 'https://cdn.example/in.mp4' } },
  );
});

test('submit sends reference images with the reference_image role BytePlus requires', async () => {
  let request;
  const adapter = createBytePlusAdapter({
    apiKey: 'secret', baseUrl: 'https://ark.example/api/v3',
    fetch: async (url, options) => { request = { url, options }; return jsonResponse({ id: 'cgt-1' }); },
  });
  await adapter.submit({ model: 'dreamina-seedance-2-0-mini-260615', prompt: 'a person wearing this outfit', referenceImages: ['https://cdn.example/person.jpg', 'https://cdn.example/outfit.jpg'] });
  const body = JSON.parse(request.options.body);
  assert.deepEqual(
    body.content.filter((part) => part.type === 'image_url'),
    [
      { type: 'image_url', role: 'reference_image', image_url: { url: 'https://cdn.example/person.jpg' } },
      { type: 'image_url', role: 'reference_image', image_url: { url: 'https://cdn.example/outfit.jpg' } },
    ],
  );
});

test('poll reads from the /tasks endpoint', async () => {
  let request;
  const adapter = createBytePlusAdapter({
    apiKey: 'secret', baseUrl: 'https://ark.example/api/v3',
    fetch: async (url) => { request = { url }; return jsonResponse({ id: 'cgt-1', status: 'succeeded', content: { video_url: 'https://tos.example/out.mp4' } }); },
  });
  const result = await adapter.poll('cgt-1');
  assert.equal(request.url, 'https://ark.example/api/v3/contents/generations/tasks/cgt-1');
  assert.equal(result.content.video_url, 'https://tos.example/out.mp4');
});

test('submit surfaces the real BytePlus error detail instead of a generic message', async () => {
  const adapter = createBytePlusAdapter({
    apiKey: 'secret', baseUrl: 'https://ark.example/api/v3',
    fetch: async () => jsonResponse({ error: { code: 'InvalidParameter', message: 'the parameter duration specified in the request is not valid' } }, { status: 400 }),
  });
  await assert.rejects(
    adapter.submit({ model: 'dreamina-seedance-2-0-mini-260615', prompt: 'test', duration: 999 }),
    (error) => {
      assert.match(error.message, /duration specified in the request is not valid/);
      assert.equal(error.code, 'BYTEPLUS_REQUEST_FAILED');
      assert.equal(error.status, 400);
      return true;
    },
  );
});

test('downloadContent reads the single-object content shape and fetches the pre-signed TOS URL directly (not through the Ark host)', async () => {
  const calls = [];
  const adapter = createBytePlusAdapter({
    apiKey: 'secret', baseUrl: 'https://ark.example/api/v3',
    fetch: async (url) => {
      calls.push(url);
      if (url.includes('ark.example')) return jsonResponse({ status: 'succeeded', content: { video_url: 'https://tos.example/out.mp4?sig=abc' } });
      return { ok: true, status: 200, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    },
  });
  const result = await adapter.downloadContent('cgt-1');
  assert.equal(calls[1], 'https://tos.example/out.mp4?sig=abc');
  assert.equal(result.contentType, 'video/mp4');
  assert.equal(result.buffer.length, 3);
});
