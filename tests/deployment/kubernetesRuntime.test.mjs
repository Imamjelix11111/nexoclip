import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('Kubernetes gateway uses service FQDNs and writable temporary Caddy state', () => {
  const caddyfile = read('deploy/caddy/Caddyfile');
  const dockerfile = read('deploy/caddy/Dockerfile');
  const httpValues = read('.ckt/cicd/charts/values-ai-ugc-http.yaml');

  for (const [name, upstream] of Object.entries({
    NEXOCLIP_UPSTREAM: 'ai-ugc-app.ai-ugc.svc.cluster.local:3000',
    SPITE_UPSTREAM: 'ai-ugc-spite.ai-ugc.svc.cluster.local:3005',
    SPITE_REALTIME_UPSTREAM: 'ai-ugc-spite-realtime.ai-ugc.svc.cluster.local:3007',
  })) {
    assert.match(caddyfile, new RegExp(`\\{\\$${name}:`));
    assert.match(httpValues, new RegExp(`${name}: ${upstream.replaceAll('.', '\\.')}`));
  }

  for (const service of ['ai-ugc-app', 'ai-ugc-spite', 'ai-ugc-spite-realtime']) {
    assert.match(caddyfile, new RegExp(`${service}\\.ai-ugc\\.svc\\.cluster\\.local`));
  }
  assert.match(dockerfile, /^FROM caddy:2\.10$/m);
  assert.match(dockerfile, /XDG_DATA_HOME=\/tmp\/caddy\/data/);
  assert.match(dockerfile, /XDG_CONFIG_HOME=\/tmp\/caddy\/config/);
});

test('realtime starts TypeScript directly instead of invoking Corepack at runtime', () => {
  const dockerfile = read('deploy/spite/Dockerfile.realtime');
  assert.match(dockerfile, /CMD \["\.\/node_modules\/\.bin\/tsx", "realtime\/server\.ts"\]/);
  assert.doesNotMatch(dockerfile, /CMD \["pnpm", "realtime"\]/);
});

test('Canvas exposes a base-path health endpoint and internal callers use service FQDNs', () => {
  assert.equal(existsSync('nexoclip-app/services/spite/app/healthz/route.ts'), true);
  const spiteValues = read('.ckt/cicd/charts/values-ai-ugc-spite.yaml');
  const appValues = read('.ckt/cicd/charts/values-ai-ugc-app.yaml');
  assert.match(spiteValues, /livenessPath: \/spite\/healthz/);
  assert.match(spiteValues, /NEXOCLIP_INTERNAL_URL: http:\/\/ai-ugc-app\.ai-ugc\.svc\.cluster\.local:3000/);
  assert.match(spiteValues, /CANVAS_AUTH_URL: http:\/\/ai-ugc-spite-realtime\.ai-ugc\.svc\.cluster\.local:3007\/internal\/authorize/);
  assert.match(appValues, /CANVAS_AUTH_URL: http:\/\/ai-ugc-spite-realtime\.ai-ugc\.svc\.cluster\.local:3007\/internal\/authorize/);
  assert.match(appValues, /AI_CLIP_RUNTIME_URL: http:\/\/ai-ugc-ai-clip\.ai-ugc\.svc\.cluster\.local:4175/);
});
