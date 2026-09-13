import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaasImageHandler } from '../../src/services/saasImageGeneration.js';

test('worker routes image jobs through the server provider router and persists tenant output', async () => {
  let received;
  const client = { query: async () => ({ rows: [{ id: 'asset-1' }] }), release() {} };
  const handler = createSaasImageHandler({
    providerRouter: { async generateImage(input) { received = input; return { provider: 'openrouter', outputs: [{ url: 'data:image/png;base64,cG5n', mimeType: 'image/png' }], usage: { total_tokens: 12 } }; } },
    storage: { async createUploadUrl() { return { url: 'local://upload' }; }, async put(_url, body, type) { assert.equal(body.toString(), 'png'); assert.equal(type, 'image/png'); } },
    pool: { async connect() { return client; } },
  });
  const result = await handler({ id: 'g1', workspace_id: 'w1', model: 'model-1', prompt: 'fox', parameters: { aspectRatio: '1:1', referenceImages: ['https://input.test/a.png'] } });
  assert.deepEqual(received, { model: 'model-1', prompt: 'fox', aspectRatio: '1:1', referenceImages: ['https://input.test/a.png'] });
  assert.deepEqual(result.outputs, [{ assetId: 'asset-1' }]);
  assert.equal(result.provider, 'openrouter');
  assert.deepEqual(result.usage, { total_tokens: 12 });
});

test('worker writes generated output directly to R2 object storage', async () => {
  const puts = [];
  const handler = createSaasImageHandler({
    providerRouter: { async generateImage() { return { provider: 'openrouter', outputs: [{ url: 'data:image/png;base64,cG5n', mimeType: 'image/png' }] }; } },
    storage: { async put(...args) { puts.push(args); } },
    pool: { async connect() { return { async query() { return { rows: [{ id: 'asset-1' }] }; }, release() {} }; } },
  });

  await handler({ id: 'g1', workspace_id: 'w1', model: 'model-1', prompt: 'fox', parameters: {} });
  assert.equal(puts[0][0].startsWith('w1/'), true);
});

test('worker leaves provider failures for the generation processor to settle safely', async () => {
  const handler = createSaasImageHandler({
    providerRouter: { async generateImage() { throw Object.assign(new Error('fallback unavailable'), { code: 'DIRECT_PROVIDER_UNAVAILABLE' }); } },
    storage: {}, pool: {},
  });
  await assert.rejects(handler({ id: 'g1', workspace_id: 'w1', model: 'model-1', prompt: 'fox', parameters: {} }), /fallback unavailable/);
});
