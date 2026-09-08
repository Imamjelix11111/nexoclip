import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('image studio requests and renders a server credit estimate', async () => {
  const source = await readFile(new URL('../../packages/studio/src/components/ImageStudio.jsx', import.meta.url), 'utf8');
  assert.match(source, /\/api\/generations\/estimate/);
  assert.match(source, /image_generation/);
  assert.match(source, /credits/);
  assert.doesNotMatch(source, /CREDITS_PER_USD|unitPrice\s*=/);
});
