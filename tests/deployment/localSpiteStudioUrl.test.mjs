import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('local Canvas returns to Studio through the public Caddy origin', () => {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  assert.match(compose, /NEXT_PUBLIC_STUDIO_URL: \$\{NEXT_PUBLIC_STUDIO_URL:-http:\/\/localhost\/studio\}/);
  assert.doesNotMatch(compose, /NEXT_PUBLIC_STUDIO_URL: \$\{NEXT_PUBLIC_STUDIO_URL:-http:\/\/localhost:3000\/studio\}/);
});
