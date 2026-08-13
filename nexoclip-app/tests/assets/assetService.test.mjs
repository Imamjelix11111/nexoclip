import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssetInput } from '../../src/services/assetService.js';

test('validates asset metadata and restricts content types', () => {
  assert.deepEqual(validateAssetInput({ filename: ' cover.png ', contentType: 'image/png', sizeBytes: 12 }), {
    filename: 'cover.png', contentType: 'image/png', sizeBytes: 12,
  });
});

test('rejects unsupported or oversized assets', () => {
  assert.throws(() => validateAssetInput({ filename: 'page.html', contentType: 'text/html', sizeBytes: 1 }), /content type/);
  assert.throws(() => validateAssetInput({ filename: 'cover.png', contentType: 'image/png', sizeBytes: 50 * 1024 * 1024 + 1 }), /size/);
});
