import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalObjectStorage } from '../../src/storage/localObjectStorage.js';

test('writes a generated asset under a relative storage root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexoclip-storage-'));
  try {
    const storage = new LocalObjectStorage({ root: path.relative(process.cwd(), root), secret: 'test-secret' });
    const upload = await storage.createUploadUrl({ key: 'workspace/asset', contentType: 'image/png' });
    await storage.put(upload.url, Buffer.from('png'), 'image/png');
    const download = await storage.createDownloadUrl({ key: 'workspace/asset' });
    assert.equal((await storage.get(download.url)).body.toString(), 'png');
  } finally { await rm(root, { recursive: true, force: true }); }
});
