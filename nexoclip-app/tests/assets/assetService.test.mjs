import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, validateAssetInput } from '../../src/services/assetService.js';
import { R2ObjectStorage } from '../../src/storage/r2ObjectStorage.js';

test('validates asset metadata and restricts content types', () => {
  assert.deepEqual(validateAssetInput({ filename: ' cover.png ', contentType: 'image/png', sizeBytes: 12 }), {
    filename: 'cover.png', contentType: 'image/png', sizeBytes: 12,
  });
});

test('rejects unsupported or oversized assets', () => {
  assert.throws(() => validateAssetInput({ filename: 'page.html', contentType: 'text/html', sizeBytes: 1 }), /content type/);
  assert.throws(() => validateAssetInput({ filename: 'cover.png', contentType: 'image/png', sizeBytes: 50 * 1024 * 1024 + 1 }), /size/);
});

test('uses R2 for asset downloads when R2 is configured', async () => {
  const keys = ['R2_BUCKET', 'R2_PUBLIC_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    R2_BUCKET: 'assets',
    R2_PUBLIC_URL: 'https://assets.example.test',
    R2_ACCOUNT_ID: 'account',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
  });

  try {
    const storage = createStorage();
    assert.ok(storage instanceof R2ObjectStorage);
    assert.deepEqual(await storage.createDownloadUrl({ key: 'workspace/asset.png' }), { url: 'workspace/asset.png' });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
