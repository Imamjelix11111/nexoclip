import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const composePath = fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url));

test('publishes the Next app while Redis and ai-storyboard remain private', () => {
  const config = execFileSync('docker', ['compose', '-f', composePath, 'config'], {
    encoding: 'utf8',
    env: {...process.env, REDIS_PASSWORD: 'test', VIMAX_RUNTIME_TOKEN: 'test'},
  });

  const service = (name) => config.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][\\w-]+:\\n|^volumes:)`, 'm'))?.[1] || '';
  const app = service('nexoclip-app');
  const redis = service('nexoclip-redis');
  const storyboard = service('ai-storyboard');

  assert.match(app, /target:\s*3000[\s\S]*published:\s*"3005"/);
  assert.doesNotMatch(redis, /^\s+ports:/m);
  assert.doesNotMatch(storyboard, /^\s+ports:/m);
});
