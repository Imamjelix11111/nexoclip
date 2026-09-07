import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const serviceBlock = (compose, name, nextName) => {
  const start = compose.indexOf(`  ${name}:\n`);
  const end = nextName ? compose.indexOf(`  ${nextName}:\n`, start + 1) : compose.indexOf('\nvolumes:', start + 1);
  assert.notEqual(start, -1, `missing service ${name}`);
  return compose.slice(start, end === -1 ? undefined : end);
};

test('production compose is AMD64 and exposes only Caddy', () => {
  const compose = read('docker-compose.prod.yml');
  const names = ['caddy', 'redis', 'nexoclip-migrate', 'scheduler-migrate', 'vimax', 'ai-clip', 'nexoclip', 'spite', 'scheduler', 'storyboard-worker'];
  names.forEach((name, index) => {
    const block = serviceBlock(compose, name, names[index + 1]);
    assert.match(block, /platform: linux\/amd64/);
    if (name === 'caddy') assert.match(block, /ports:/);
    else assert.doesNotMatch(block, /\n\s+ports:/);
  });
});

test('deployment files and routes exist', () => {
  for (const path of ['Caddyfile', '.dockerignore', '.env.production.example', 'services/spite/Dockerfile', 'services/free-ai-social-media-scheduler/Dockerfile', 'services/ai-clip/Dockerfile']) {
    assert.equal(existsSync(path), true, `missing ${path}`);
  }
  const caddy = read('Caddyfile');
  assert.match(caddy, /handle_path \/ai-clip-api\/\*/);
  assert.match(caddy, /handle \/spite\*/);
  assert.match(caddy, /handle \/scheduler\*/);
});

test('Docker context excludes secrets', () => {
  const ignore = read('.dockerignore');
  assert.match(ignore, /^\.env\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
  assert.match(ignore, /^!\.env\.production\.example$/m);
});
