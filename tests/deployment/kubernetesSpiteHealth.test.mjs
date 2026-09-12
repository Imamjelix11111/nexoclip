import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Canvas health endpoint bypasses setup and authentication middleware', () => {
  const middleware = readFileSync('nexoclip-app/services/spite/middleware.ts', 'utf8');
  const healthIndex = middleware.indexOf("'/healthz'");
  const setupIndex = middleware.indexOf("'/setup'");
  assert.ok(healthIndex >= 0, 'healthz must be public');
  assert.ok(healthIndex < setupIndex, 'healthz must be checked before setup redirects');
  assert.match(middleware, /if \(appPath === '\/healthz' \|\| pathname\.endsWith\('\/healthz'\)\)/, 'base-path healthz must bypass setup and authentication');
});
