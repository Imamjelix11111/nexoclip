import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const blueprint = readFileSync('render.yaml', 'utf8');
const service = (name) => blueprint.split(/^  - type: /m).find((entry) => new RegExp(`^    name: ${name}$`, 'm').test(entry)) ?? '';
const envValue = (entry, key) => entry.match(new RegExp(`key: ${key}([\\s\\S]*?)(?=\\n      - key:|$)`))?.[1] ?? '';

test('Render blueprint declares the complete Singapore stack', () => {
  for (const name of [
    'ai-ugc-http', 'ai-ugc-app', 'ai-ugc-spite', 'ai-ugc-spite-realtime',
    'ai-ugc-ai-clip', 'ai-ugc-image-worker', 'ai-ugc-video-worker',
    'ai-ugc-postgres', 'ai-ugc-redis',
  ]) assert.match(blueprint, new RegExp(`name: ${name}$`, 'm'));
  assert.match(blueprint, /^    region: singapore$/m);
  assert.match(blueprint, /type: web[\s\S]*name: ai-ugc-http|name: ai-ugc-http[\s\S]*type: web/);
  assert.doesNotMatch(blueprint, /(postgresql:\/\/[^$\s]|AKIA|-----BEGIN|OPENAI_API_KEY:\s*[^$\s])/);
});

test('Render blueprint has one public gateway and private application services', () => {
  assert.equal((blueprint.match(/^  - type: web$/gm) ?? []).length, 1);
  assert.match(service('ai-ugc-app'), /^pserv$/m);
  assert.match(service('ai-ugc-app'), /dockerBuildTarget: web/);
  for (const name of ['ai-ugc-spite', 'ai-ugc-spite-realtime', 'ai-ugc-ai-clip']) {
    assert.match(service(name), /^pserv$/m);
  }
  for (const name of ['ai-ugc-image-worker', 'ai-ugc-video-worker']) {
    assert.match(service(name), /^worker$/m);
  }
});

test('Caddy receives all private upstream hostports from Render services', () => {
  const caddy = service('ai-ugc-http');
  for (const [key, name] of Object.entries({
    NEXOCLIP_UPSTREAM: 'ai-ugc-app',
    SPITE_UPSTREAM: 'ai-ugc-spite',
    SPITE_REALTIME_UPSTREAM: 'ai-ugc-spite-realtime',
  })) {
    const value = envValue(caddy, key);
    assert.match(value, new RegExp(`fromService:[\\s\\S]*?type: pserv[\\s\\S]*?name: ${name}[\\s\\S]*?property: hostport`));
  }
});

test('only NexoClip services use Task 2 Render infrastructure', () => {
  for (const name of ['ai-ugc-app', 'ai-ugc-image-worker', 'ai-ugc-video-worker']) {
    const entry = service(name);
    assert.match(envValue(entry, 'DATABASE_URL'), /fromDatabase:[\s\S]*?name: ai-ugc-postgres[\s\S]*?property: connectionString/);
  }

  for (const name of ['ai-ugc-app', 'ai-ugc-image-worker', 'ai-ugc-video-worker']) {
    const entry = service(name);
    assert.match(envValue(entry, 'REDIS_URL'), /fromService:[\s\S]*?type: keyvalue[\s\S]*?name: ai-ugc-redis[\s\S]*?property: connectionString/);
  }

  for (const name of ['ai-ugc-spite', 'ai-ugc-spite-realtime']) {
    const entry = service(name);
    assert.doesNotMatch(entry, /key: DATABASE_URL(?:\n|[\s\S])*?fromDatabase:/);
    assert.doesNotMatch(entry, /key: REDIS_URL(?:\n|[\s\S])*?fromService:/);
  }

  assert.doesNotMatch(service('ai-ugc-app'), /key: AI_CLIP_RUNTIME_URL/);
  assert.doesNotMatch(service('ai-ugc-app'), /key: CANVAS_AUTH_URL/);
  assert.doesNotMatch(service('ai-ugc-spite'), /key: NEXOCLIP_INTERNAL_URL/);
  assert.doesNotMatch(service('ai-ugc-spite'), /key: CANVAS_AUTH_URL/);
});
