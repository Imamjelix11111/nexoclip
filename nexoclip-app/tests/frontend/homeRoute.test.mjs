import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('root route enters hosted SaaS authentication while legacy studio stays explicit', () => {
  const source = read('app/page.js');

  assert.match(source, /redirect\(['"]\/login['"]\)/);
  assert.doesNotMatch(source, /redirect\(['"]\/studio['"]\)/);
});
