import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveReferenceImages } from '../../src/services/saasImageGeneration.js';

test('resolves an authenticated asset reference into a provider-readable data URL', async () => {
  const pool = {
    query: async () => ({ rows: [{ storage_key: 'workspace-1/uploads/reference.png', content_type: 'image/png' }] }),
  };
  const storage = {
    createDownloadUrl: async ({ key }) => {
      assert.equal(key, 'workspace-1/uploads/reference.png');
      return { url: 'local://download?signature=test' };
    },
    get: async (url) => {
      assert.equal(url, 'local://download?signature=test');
      return { body: Buffer.from('image'), contentType: 'image/png' };
    },
  };

  const images = await resolveReferenceImages({
    workspaceId: 'workspace-1',
    referenceImages: ['/api/assets/asset-1/download?workspace_id=workspace-1'],
    pool,
    storage,
  });

  assert.deepEqual(images, ['data:image/png;base64,aW1hZ2U=']);
});
