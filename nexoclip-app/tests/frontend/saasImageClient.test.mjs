import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../packages/studio/src/generationClient.js', import.meta.url), 'utf8');

test('SaaS image polling turns stored asset output into an authenticated download route', () => {
  assert.match(source, /\/api\/assets\/\$\{encodeURIComponent\(output\.assetId\)\}\/download\?workspace_id=/);
});
