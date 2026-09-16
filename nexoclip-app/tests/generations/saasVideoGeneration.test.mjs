import test from 'node:test';
import assert from 'node:assert/strict';

const { createSaasVideoHandler } = await import('../../src/services/saasVideoGeneration.js');

test('durable video handler submits, polls, downloads, and persists a tenant asset', async () => {
  const puts = [];
  const handler = createSaasVideoHandler({
    pool: { async connect() { return { async query() { return { rows: [{ id: 'asset-1' }] }; }, release() {} }; } },
    storage: { async createUploadUrl() { return { url: 'upload' }; }, async put(...args) { puts.push(args); } },
    providerRouter: {
      async submitVideo() { return { id: 'provider-job', provider: 'openrouter' }; },
      async pollVideo() { return { status: 'completed' }; },
      async downloadVideo() { return { buffer: Buffer.from('video'), contentType: 'video/mp4' }; },
    },
    createAsset: async () => ({ id: 'asset-1' }),
    sleep: async () => {},
  });
  const result = await handler({ id: 'job-1', workspace_id: 'workspace-1', model: 'bytedance/seedance-2.0', prompt: 'hello', parameters: { aspectRatio: '9:16', duration: 5 } });
  assert.equal(result.outputs[0].assetId, 'asset-1');
  assert.equal(puts.length, 1);
});

test('durable video handler writes directly when storage has no presigned upload API', async () => {
  const puts = [];
  const handler = createSaasVideoHandler({
    pool: { async connect() { return { release() {} }; } },
    storage: { async put(...args) { puts.push(args); } },
    providerRouter: {
      async submitVideo() { return { id: 'provider-job', provider: 'byteplus' }; },
      async pollVideo() { return { status: 'completed' }; },
      async downloadVideo() { return { buffer: Buffer.from('video'), contentType: 'video/mp4' }; },
    },
    createAsset: async () => ({ id: 'asset-1' }),
    sleep: async () => {},
  });

  await handler({ id: 'job-1', workspace_id: 'workspace-1', model: 'byteplus/dreamina-seedance-2-0-260128', prompt: 'hello', parameters: {} });

  assert.equal(puts.length, 1);
  assert.match(puts[0][0], /^workspace-1\//);
  assert.equal(puts[0][1].toString(), 'video');
  assert.equal(puts[0][2], 'video/mp4');
});
