import test from 'node:test';
import assert from 'node:assert/strict';
import { R2ObjectStorage } from '../../src/storage/r2ObjectStorage.js';

test('uploads generated assets to R2 and returns encoded public URL', async () => {
  const calls = [];
  const storage = new R2ObjectStorage({
    bucket: 'images',
    publicUrl: 'https://cdn.example.test',
    client: { send: async (command) => { calls.push(command.input); } },
  });
  const url = await storage.put('workspace/generated/a b.png', Buffer.from('image'), 'image/png');
  assert.equal(url, 'https://cdn.example.test/workspace/generated/a%20b.png');
  assert.equal(calls[0].Bucket, 'images');
  assert.equal(calls[0].Key, 'workspace/generated/a b.png');
  assert.equal(calls[0].ContentType, 'image/png');
});

test('downloads R2 streams as provider-readable buffers', async () => {
  const storage = new R2ObjectStorage({
    bucket: 'images',
    publicUrl: 'https://cdn.example.test',
    client: {
      send: async () => ({
        Body: { transformToByteArray: async () => Uint8Array.from([104, 101, 114, 111]) },
        ContentType: 'image/jpeg',
      }),
    },
  });

  const object = await storage.get('uploads/hero.jpeg');
  assert.equal(Buffer.isBuffer(object.body), true);
  assert.equal(object.body.toString(), 'hero');
  assert.equal(object.contentType, 'image/jpeg');
});
