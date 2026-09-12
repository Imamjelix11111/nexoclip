import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ignore = readFileSync('.dockerignore', 'utf8');

test('root Docker context excludes local dependency, build, and secret artifacts', () => {
  for (const pattern of ['**/node_modules', '**/.next', '.env*', '**/.env*']) {
    assert.match(ignore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
  assert.match(ignore, /^\.git$/m);
  assert.match(ignore, /^\*\*\/\.venv$/m);
});
