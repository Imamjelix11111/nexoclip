import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../packages/studio/src/generationClient.js', import.meta.url), 'utf8');

test('SaaS media client submits video jobs through the credited generations API', () => {
  assert.match(source, /export async function generateSaasVideo\(/);
  assert.match(source, /kind: 'video'/);
  assert.doesNotMatch(source, /generateSaasVideo\([^)]*apiKey/);
});

test('SaaS video client provides an animation prompt for image-to-video jobs', () => {
  assert.match(source, /prompt: params\.prompt \|\| 'Animate the provided reference\.'/);
});
