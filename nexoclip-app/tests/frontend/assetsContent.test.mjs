import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../src/services/assetService.js', import.meta.url), 'utf8');

test('asset listing uses the authenticated download route instead of a storage URL', () => {
  assert.match(source, /\/api\/assets\/\$\{encodeURIComponent\(asset\.id\)\}\/download\?workspace_id=/);
  assert.doesNotMatch(source, /R2_PUBLIC_URL/);
});
