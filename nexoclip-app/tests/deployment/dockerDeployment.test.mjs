import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const readJson = (path) => JSON.parse(read(path));

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

  const productionEnv = read('.env.production.example');
  assert.match(productionEnv, /^SPITE_OWNER_USER_ID=/m);
  assert.match(productionEnv, /^# SPITE_ALLOW_DETERMINISTIC_FIRST_USER=1$/m);
});

test('Docker context excludes secrets', () => {
  const ignore = read('.dockerignore');
  assert.match(ignore, /^\.env\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
  assert.match(ignore, /^!\.env\.production\.example$/m);
});

test('deploy script validates the host and runs migrations before startup', () => {
  const script = read('scripts/deploy.sh');
  assert.match(script, /^#!\/usr\/bin\/env bash\nset -Eeuo pipefail/);
  assert.match(script, /uname -m/);
  assert.match(script, /x86_64\/AMD64/);
  assert.match(script, /stat -c '%a' \.env\.production/);
  assert.match(script, /config --quiet/);
  assert.ok(script.indexOf('"${compose[@]}" build') < script.indexOf('run --rm nexoclip-migrate'));
  assert.ok(script.indexOf('run --rm nexoclip-migrate') < script.indexOf('up -d --remove-orphans'));
  assert.ok(script.indexOf('run --rm scheduler-migrate') < script.indexOf('up -d --remove-orphans'));
  assert.match(script, /"\$\{compose\[@\]\}" ps/);
});

test('Compose protects stateful services and separates databases', () => {
  const compose = read('docker-compose.prod.yml');
  assert.match(serviceBlock(compose, 'caddy', 'redis'), /\$\{HTTP_PORT:-80\}:80/);
  assert.match(serviceBlock(compose, 'redis', 'nexoclip-migrate'), /--requirepass/);
  assert.match(serviceBlock(compose, 'redis', 'nexoclip-migrate'), /redis-cli -a/);
  assert.match(serviceBlock(compose, 'nexoclip-migrate', 'scheduler-migrate'), /DATABASE_URL_NEXOCLIP/);
  assert.match(serviceBlock(compose, 'scheduler-migrate', 'vimax'), /DATABASE_URL_SCHEDULER/);
  assert.match(serviceBlock(compose, 'spite', 'scheduler'), /DATABASE_URL_SPITE/);
  assert.match(serviceBlock(compose, 'ai-clip', 'nexoclip'), /\/healthz/);
  assert.match(serviceBlock(compose, 'vimax', 'ai-clip'), /\/healthz/);
  for (const volume of ['redis-data', 'vimax-tenants', 'ai-clip-output', 'caddy-data', 'caddy-config']) {
    assert.match(compose, new RegExp(`^  ${volume}:`, 'm'));
  }
});

test('Realtime dependency contract is pinned in app and spite manifests', () => {
  const spitePackage = readJson('services/spite/package.json');
  const appPackage = readJson('package.json');

  const providerVersion = spitePackage.dependencies['@hocuspocus/provider'];
  const serverVersion = spitePackage.dependencies['@hocuspocus/server'];

  assert.equal(typeof providerVersion, 'string');
  assert.equal(typeof serverVersion, 'string');
  assert.match(providerVersion, /^4\.6\./, '@hocuspocus/provider must stay on 4.6.x');
  assert.match(serverVersion, /^4\.6\./, '@hocuspocus/server must stay on 4.6.x');
  assert.equal(providerVersion, serverVersion, 'provider/server pins must match exactly');
  assert.equal(spitePackage.dependencies.yjs, '13.6.32');
  assert.equal(spitePackage.dependencies['y-protocols'], '1.0.7');
  assert.equal(spitePackage.dependencies.jose, '6.2.12');
  assert.equal(appPackage.dependencies.jose, '6.2.12');
});
