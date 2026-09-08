import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../packages/studio/src/components/VideoStudio.jsx', import.meta.url), 'utf8');

test('Video Studio submits only durable SaaS video jobs', () => {
  assert.match(source, /generateSaasVideo/);
  assert.doesNotMatch(source, /generateVideo\(apiKey/);
  assert.doesNotMatch(source, /generateI2V\(apiKey/);
  assert.doesNotMatch(source, /processV2V\(apiKey/);
});
