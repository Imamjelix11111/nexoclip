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
