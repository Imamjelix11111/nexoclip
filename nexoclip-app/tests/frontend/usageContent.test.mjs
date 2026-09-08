import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('usage content formats values and builds same-origin paths', async () => {
  const source = await readFile(new URL('../../components/UsageContent.js', import.meta.url), 'utf8');
  assert.match(source, /function formatCredits/);
  assert.match(source, /function formatUnits/);
  assert.match(source, /function usagePath/);
  assert.match(source, /\/api\/usage\?scope=/);
  assert.doesNotMatch(source, /raw_usage|actual_cost|authorization|x-api-key/);
});

test('studio shell integrates Usage and credit balance navigation', async () => {
  const source = await readFile(new URL('../../components/StandaloneShell.js', import.meta.url), 'utf8');
  assert.match(source, /import UsageContent from ['"]\.\/UsageContent/);
  assert.match(source, /id:\s*['"]usage['"]/);
  assert.match(source, /handleTabChange\('usage'\)/);
  assert.match(source, /firstSegment && TABS\.find\(t => t\.id === firstSegment\)/);
  assert.match(source, /credits/);
  assert.doesNotMatch(source, /\$\{balance/);
});
