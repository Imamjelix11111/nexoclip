import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const blueprint = read('render.yaml');

// Render's Blueprint subset is deliberately scanned by indentation here rather than
// introducing a YAML dependency just for deployment-contract tests.
function listEntries(section) {
  const start = blueprint.indexOf(`${section}:\n`);
  assert.notEqual(start, -1, `missing ${section} list`);
  const content = blueprint.slice(start + section.length + 2);
  const nextSection = content.search(/^[a-zA-Z]+:\s*$/m);
  return content.slice(0, nextSection === -1 ? undefined : nextSection)
    .split(/^  - /m).slice(1).map((entry) => entry.trimEnd());
}

function field(entry, key) {
  return entry.match(new RegExp(`^(?:    )?${key}: (.+)$`, 'm'))?.[1];
}

function named(entries, name) {
  const entry = entries.find((candidate) => field(candidate, 'name') === name);
  assert.ok(entry, `missing resource ${name}`);
  return entry;
}

function env(entry, key) {
  const match = entry.match(new RegExp(`^      - key: ${key}$([\\s\\S]*?)(?=\\n      - key:|(?![\\s\\S]))`, 'm'));
  assert.ok(match, `missing ${key} environment value`);
  return match[1].trim();
}

const services = listEntries('services');
const databases = listEntries('databases');
const requiredServices = {
  'ai-ugc-redis': 'keyvalue',
  'ai-ugc-http': 'web',
  'ai-ugc-app': 'pserv',
  'ai-ugc-spite': 'pserv',
  'ai-ugc-spite-realtime': 'pserv',
  'ai-ugc-ai-clip': 'pserv',
  'ai-ugc-image-worker': 'worker',
  'ai-ugc-video-worker': 'worker',
};

function assertDockerService(name, contract) {
  const entry = named(services, name);
  assert.equal(field(entry, 'type'), requiredServices[name]);
  assert.equal(field(entry, 'region'), 'singapore');
  assert.equal(field(entry, 'runtime'), 'docker');
  for (const [key, value] of Object.entries(contract)) assert.equal(field(entry, key), value);
  return entry;
}

function assertConnection(entry, key, source, name) {
  const value = env(entry, key);
  assert.match(value, new RegExp(`^${source}:\\n(?:          type: (?:keyvalue|pserv)\\n)?          name: ${name}\\n          property: connectionString$`, 'm'));
}

test('Render Blueprint contains exactly the required Singapore resources', () => {
  assert.deepEqual(databases.map((entry) => field(entry, 'name')), ['ai-ugc-postgres']);
  const database = named(databases, 'ai-ugc-postgres');
  assert.equal(field(database, 'databaseName'), 'nexoclip');
  assert.equal(field(database, 'user'), 'nexoclip');
  assert.equal(field(database, 'region'), 'singapore');
  assert.equal(field(database, 'plan'), 'basic-256mb');

  assert.deepEqual(Object.fromEntries(services.map((entry) => [field(entry, 'name'), field(entry, 'type')])), requiredServices);
  for (const entry of services) assert.equal(field(entry, 'region'), 'singapore');
  const redis = named(services, 'ai-ugc-redis');
  assert.equal(field(redis, 'plan'), 'free');
  assert.equal(field(redis, 'ipAllowList'), '[]');
  assert.equal(services.filter((entry) => field(entry, 'type') === 'web').length, 1);
  assert.doesNotMatch(blueprint, /(postgresql:\/\/[^$\s]|AKIA|-----BEGIN|OPENAI_API_KEY:\s*[^$\s])/);
});

test('each Render service has its required build, routing, and health contract', () => {
  const gateway = assertDockerService('ai-ugc-http', {
    rootDir: '.', dockerfilePath: 'deploy/caddy/Dockerfile', dockerContext: '.', healthCheckPath: '/healthz',
  });
  const app = assertDockerService('ai-ugc-app', {
    rootDir: '.', dockerfilePath: 'nexoclip-app/Dockerfile', dockerContext: '.', preDeployCommand: 'node src/db/migrate.js', healthCheckPath: '/',
  });
  assertDockerService('ai-ugc-spite', {
    rootDir: '.', dockerfilePath: 'deploy/spite/Dockerfile.web', dockerContext: '.', healthCheckPath: '/spite/healthz',
  });
  assertDockerService('ai-ugc-spite-realtime', {
    rootDir: '.', dockerfilePath: 'deploy/spite/Dockerfile.realtime', dockerContext: '.', healthCheckPath: '/healthz',
  });
  assertDockerService('ai-ugc-ai-clip', {
    rootDir: '.', dockerfilePath: 'deploy/ai-clip/Dockerfile', dockerContext: '.', healthCheckPath: '/healthz',
  });
  for (const [name, kind] of [['ai-ugc-image-worker', 'image'], ['ai-ugc-video-worker', 'video']]) {
    const worker = assertDockerService(name, {
      rootDir: '.', dockerfilePath: 'deploy/nexoclip/Dockerfile.worker', dockerContext: '.', dockerCommand: 'node src/queue/workerService.mjs',
    });
    assert.equal(env(worker, 'GENERATION_WORKER_KIND'), `value: ${kind}`);
  }

  for (const [key, name] of Object.entries({
    NEXOCLIP_UPSTREAM: 'ai-ugc-app', SPITE_UPSTREAM: 'ai-ugc-spite', SPITE_REALTIME_UPSTREAM: 'ai-ugc-spite-realtime',
  })) {
    assert.match(env(gateway, key), new RegExp(`^fromService:\\n          type: pserv\\n          name: ${name}\\n          property: hostport$`, 'm'));
  }
  for (const key of ['DATABASE_URL', 'DATABASE_URL_NEXOCLIP']) assertConnection(app, key, 'fromDatabase', 'ai-ugc-postgres');
  assert.equal(env(app, 'AI_CLIP_RUNTIME_URL'), 'value: http://ai-ugc-ai-clip:4175');
  for (const key of ['DATABASE_URL_SPITE', 'CANVAS_AUTH_HMAC_SECRET', 'REALTIME_JWT_SECRET']) {
    assert.match(blueprint, new RegExp(`key: ${key}[\\s\\S]*sync: false`));
  }
  assert.match(env(named(services, 'ai-ugc-spite'), 'NEXOCLIP_INTERNAL_URL'), /http:\/\/ai-ugc-app:3000/);
  assert.match(env(named(services, 'ai-ugc-spite'), 'CANVAS_AUTH_URL'), /http:\/\/ai-ugc-spite-realtime:3007\/internal\/authorize/);
});

test('only NexoClip app and workers consume Task 2 database and Redis', () => {
  for (const name of ['ai-ugc-app', 'ai-ugc-image-worker', 'ai-ugc-video-worker']) {
    const entry = named(services, name);
    assertConnection(entry, 'DATABASE_URL', 'fromDatabase', 'ai-ugc-postgres');
    assertConnection(entry, 'REDIS_URL', 'fromService', 'ai-ugc-redis');
  }
  for (const name of ['ai-ugc-spite', 'ai-ugc-spite-realtime', 'ai-ugc-ai-clip']) {
    const entry = named(services, name);
    assert.doesNotMatch(entry, /fromDatabase:\n\s+name: ai-ugc-postgres|fromService:\n\s+type: keyvalue\n\s+name: ai-ugc-redis/);
  }
});

test('Render Blueprint uses only supported Docker service fields', () => {
  assert.doesNotMatch(blueprint, /^\s+(?:dockerBuildTarget|dockerBuildArgs):/m);
});

test('Render runtime wiring uses placeholders rather than Compose credentials', () => {
  assert.doesNotMatch(blueprint, /(POSTGRES_PASSWORD|REDIS_PASSWORD|postgresql:\/\/[^$\s])/);
  assert.doesNotMatch(blueprint, /(?:value:\s*redis:\/\/|value:\s*postgres(?:ql)?:\/\/)/);
});

test('the Render app target builds without BuildKit secrets or embedded credentials', () => {
  const dockerfile = read('nexoclip-app/Dockerfile');
  assert.doesNotMatch(dockerfile, /--mount=type=secret|\/run\/secrets|build_env/);
  assert.match(dockerfile, /DATABASE_URL=postgresql:\/\/build:build@127\.0\.0\.1:1\/build npm run build/);
  assert.doesNotMatch(dockerfile, /(?:PASSWORD|API_KEY|SECRET)=\S+/);
});
