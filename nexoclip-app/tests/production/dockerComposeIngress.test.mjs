import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const composePath = fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url));

function readService(config, name) {
  return config.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][\\w-]+:\\n|^volumes:)`, 'm'))?.[1] || '';
}

test('publishes only browser-facing local services while realtime and jobs stay private', () => {
  const config = execFileSync('docker', ['compose', '-f', composePath, 'config'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      REDIS_PASSWORD: 'test',
      VIMAX_RUNTIME_TOKEN: 'test',
      DATABASE_URL_SPITE: 'postgres://user:pass@db.example/spite',
      SPITE_APP_PASSWORD: 'test',
      OPENAI_API_KEY: 'test',
      BYTEPLUS_API_KEY: 'test',
      R2_ACCOUNT_ID: 'test',
      R2_ACCESS_KEY_ID: 'test',
      R2_SECRET_ACCESS_KEY: 'test',
      R2_BUCKET_NAME: 'test',
      CANVAS_AUTH_HMAC_SECRET: 'test',
      REALTIME_JWT_SECRET: 'test',
      SPITE_OWNER_USER_ID: '550e8400-e29b-41d4-a716-446655440001',
    },
  });

  const app = readService(config, 'nexoclip-app');
  const spite = readService(config, 'spite');
  const realtime = readService(config, 'spite-realtime');
  const realtimeMigrate = readService(config, 'spite-realtime-migrate');
  const ownershipMigrate = readService(config, 'spite-ownership-migrate');
  const redis = readService(config, 'nexoclip-redis');
  const storyboard = readService(config, 'ai-storyboard');

  assert.match(app, /target:\s*3000[\s\S]*published:\s*"3000"/);
  assert.match(spite, /target:\s*3005[\s\S]*published:\s*"3005"/);
  assert.doesNotMatch(realtime, /^\s+ports:/m);
  assert.match(realtime, /^\s+expose:\n\s+- "3007"/m);
  assert.doesNotMatch(realtimeMigrate, /^\s+ports:/m);
  assert.doesNotMatch(ownershipMigrate, /^\s+ports:/m);
  assert.doesNotMatch(redis, /^\s+ports:/m);
  assert.doesNotMatch(storyboard, /^\s+ports:/m);
});
