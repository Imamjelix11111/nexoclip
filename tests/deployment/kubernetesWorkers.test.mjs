import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('Kubernetes deploys dedicated image and video BullMQ workers', () => {
  const config = read('.ckt/cicd/config.yaml');
  const imageValues = read('.ckt/cicd/charts/values-ai-ugc-image-worker.yaml');
  const videoValues = read('.ckt/cicd/charts/values-ai-ugc-video-worker.yaml');
  const dockerfile = read('deploy/nexoclip/Dockerfile.worker');

  for (const component of ['ai-ugc-image-worker', 'ai-ugc-video-worker']) {
    assert.match(config, new RegExp(`- name: ${component}`));
  }
  assert.match(config, /docker_filepath: deploy\/nexoclip\/Dockerfile\.worker/);
  assert.match(imageValues, /GENERATION_WORKER_KIND: image/);
  assert.match(videoValues, /GENERATION_WORKER_KIND: video/);
  assert.match(imageValues, /externalSecret:/);
  assert.match(videoValues, /externalSecret:/);
  assert.match(dockerfile, /CMD \["node", "src\/queue\/workerService\.mjs"\]/);
  const service = read('nexoclip-app/src/queue/workerService.mjs');
  assert.match(service, /kind === 'image' \? createImageWorker/);
  assert.match(service, /kind === 'video' \? createVideoWorker/);
});

test('realtime image installs all dependencies with pnpm v12', () => {
  const dockerfile = read('deploy/spite/Dockerfile.realtime');
  assert.match(dockerfile, /RUN pnpm install --frozen-lockfile$/m);
  assert.doesNotMatch(dockerfile, /--prod=false/);
});
