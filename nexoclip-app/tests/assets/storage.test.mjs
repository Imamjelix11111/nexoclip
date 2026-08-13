import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalObjectStorage } from '../../src/storage/localObjectStorage.js';

test('local storage uploads bytes and creates a signed download URL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexoclip-storage-'));
  try {
    const storage = new LocalObjectStorage({ root, secret: 'test-secret' });
    const upload = await storage.createUploadUrl({ key: 'workspace-1/asset-1', contentType: 'image/png' });
    assert.equal(upload.method, 'PUT');

    await storage.put(upload.url, Buffer.from('image-bytes'), 'image/png');
    const download = await storage.createDownloadUrl({ key: 'workspace-1/asset-1', expiresInSeconds: 60 });
    assert.equal(download.method, 'GET');
    assert.deepEqual(await storage.get(download.url), {
      body: Buffer.from('image-bytes'),
      contentType: 'image/png',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local storage rejects expired or tampered signed URLs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexoclip-storage-'));
  try {
    const storage = new LocalObjectStorage({ root, secret: 'test-secret' });
    const upload = await storage.createUploadUrl({ key: 'workspace-1/asset-1', expiresInSeconds: -1 });
    await assert.rejects(() => storage.put(upload.url, Buffer.from('x'), 'text/plain'), /expired/);
    await assert.rejects(() => storage.get(upload.url.replace(/.$/, 'x')), /Invalid|expired/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
