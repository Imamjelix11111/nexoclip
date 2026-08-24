import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouterVideoAdapter } from '../../src/providers/openrouter/videoAdapter.js';

function jsonResponse(body, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

test('submit sends a reference video as an input_references entry of type video_url', async () => {
  let request;
  const adapter = createOpenRouterVideoAdapter({
    apiKey: 'server-secret',
    fetch: async (url, options) => { request = { url, options }; return jsonResponse({ id: 'job-1' }); },
  });

  await adapter.submit({ model: 'runway/aleph-2', prompt: 'make it night time', referenceVideos: ['https://cdn.example/in.mp4'] });

  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.input_references, [{ type: 'video_url', video_url: { url: 'https://cdn.example/in.mp4' } }]);
});

test('submit sends the reference video as a top-level `video` field for alibaba/wan-2.7 (rejects input_references video_url)', async () => {
  let request;
  const adapter = createOpenRouterVideoAdapter({
    apiKey: 'server-secret',
    fetch: async (url, options) => { request = { url, options }; return jsonResponse({ id: 'job-1' }); },
  });

  await adapter.submit({ model: 'alibaba/wan-2.7', prompt: 'extend this video', referenceVideos: ['https://cdn.example/in.mp4'] });

  const body = JSON.parse(request.options.body);
  assert.equal(body.video, 'https://cdn.example/in.mp4');
  assert.equal(body.input_references, undefined);
});

test('submit combines reference videos and reference images when both are given', async () => {
  let request;
  const adapter = createOpenRouterVideoAdapter({
    apiKey: 'server-secret',
    fetch: async (url, options) => { request = { url, options }; return jsonResponse({ id: 'job-1' }); },
  });

  await adapter.submit({
    model: 'runway/aleph-2', prompt: 'edit', referenceVideos: ['https://cdn.example/in.mp4'], referenceImages: ['https://cdn.example/ref.png'],
  });

  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.input_references, [
    { type: 'video_url', video_url: { url: 'https://cdn.example/in.mp4' } },
    { type: 'image_url', image_url: { url: 'https://cdn.example/ref.png' } },
  ]);
});
