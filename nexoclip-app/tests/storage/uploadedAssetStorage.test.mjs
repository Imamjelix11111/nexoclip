import test from 'node:test';
import assert from 'node:assert/strict';
import { putUploadedObject } from '../../src/services/uploadedAssetService.js';

test('stores uploads through a LocalObjectStorage signed upload URL when R2 is unavailable', async () => {
  const calls = [];
  const storage = {
    createUploadUrl: async (input) => {
      calls.push(['createUploadUrl', input]);
      return { url: 'local://upload?signature=test' };
    },
    put: async (...input) => calls.push(['put', input]),
  };

  await putUploadedObject(storage, 'workspace/uploads/image.png', Buffer.from('image'), 'image/png');

  assert.deepEqual(calls, [
    ['createUploadUrl', { key: 'workspace/uploads/image.png', contentType: 'image/png' }],
    ['put', ['local://upload?signature=test', Buffer.from('image'), 'image/png']],
  ]);
});
