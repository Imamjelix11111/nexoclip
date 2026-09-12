import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('local Caddy routes to the root Compose service names', () => {
  const caddyfile = readFileSync('Caddyfile', 'utf8');
  assert.match(caddyfile, /reverse_proxy nexoclip-app:3000/);
  assert.match(caddyfile, /reverse_proxy spite:3005/);
  assert.match(caddyfile, /reverse_proxy spite-realtime:3007/);
  assert.doesNotMatch(caddyfile, /reverse_proxy nexoclip:3000/);
});
