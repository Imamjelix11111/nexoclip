import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaasImageHandler } from '../../src/services/saasImageGeneration.js';

test('worker image handler persists provider output as a tenant asset', async () => {
  const calls = [];
  const client = { query: async (text, values) => { calls.push({ text, values }); return { rows: [{ id: 'asset-1' }] }; }, release() {} };
  const handler = createSaasImageHandler({
    provider: { async submitGeneration() { return { providerRequestId: 'request-1', outputs: ['https://provider.test/image.png'] }; } },
    storage: {
      async createUploadUrl(input) { return { url: `local://upload?key=${input.key}` }; },
      async put(url, body, contentType) { assert.match(url, /^local:/); assert.equal(body.length, 3); assert.equal(contentType, 'image/png'); },
    },
    pool: { async connect() { return client; } },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from('png'), { status: 200, headers: { 'content-type': 'image/png' } });
  try {
    const result = await handler({ id: 'generation-1', workspace_id: 'workspace-1', model: 'image-model', prompt: 'fox', parameters: { aspectRatio: '1:1' } });
    assert.deepEqual(result.outputs, [{ assetId: 'asset-1' }]);
    assert.equal(calls.length, 1);
    assert.match(calls[0].values[0], /^workspace-1$/);
  } finally { globalThis.fetch = originalFetch; }
});
