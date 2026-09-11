import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('Kubernetes images run as the platform-standard non-root user', () => {
  for (const path of [
    'deploy/caddy/Dockerfile',
    'deploy/spite/Dockerfile.web',
    'deploy/spite/Dockerfile.realtime',
    'deploy/ai-clip/Dockerfile',
    'deploy/nexoclip/Dockerfile.worker',
  ]) {
    assert.match(read(path), /USER 1001:1001$/m, `${path} must run as 1001:1001`);
  }
});
