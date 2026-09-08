import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../packages/studio/src/components/AiInfluencerStudio.jsx', import.meta.url), 'utf8');

test('AI Influencer submits portraits through the SaaS image client', () => {
  assert.match(source, /generateSaasImage/);
  assert.doesNotMatch(source, /generateImage\(apiKey/);
});
