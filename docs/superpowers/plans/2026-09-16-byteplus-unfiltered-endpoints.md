# BytePlus Dedicated Unfiltered Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separate Canvas model choices that route Seedance 2.0, Seedance 2.5, and Seedream 5.0 Pro to environment-configured ModelArk inference endpoints.

**Architecture:** Extend direct-provider model metadata with an optional endpoint environment key. The provider router resolves dedicated aliases server-side and invokes the existing BytePlus image/video adapters directly, while standard aliases retain their current base-model routing.

**Tech Stack:** Node.js ESM, TypeScript, Next.js, Node test runner, Docker Compose.

## Global Constraints

- Preserve every existing standard model and base-model route.
- Add `Seedance 2.0 Unfiltered`, `Seedance 2.5 Unfiltered`, and `Seedream 5.0 Pro Unfiltered` as distinct Canvas choices.
- Persist stable application aliases, never deployment-specific endpoint IDs, in Canvas state.
- Resolve endpoint IDs from `BYTEPLUS_SEEDANCE_2_ENDPOINT`, `BYTEPLUS_SEEDANCE_2_5_ENDPOINT`, and `BYTEPLUS_SEEDREAM_5_ENDPOINT` only on the server.
- Fail closed with `BYTEPLUS_ENDPOINT_NOT_CONFIGURED` and status `503` when the selected endpoint variable is absent.
- Never silently fall back from a dedicated alias to a base model or OpenRouter.
- Reuse the existing BytePlus API key, base URL, provider adapters, reference ordering, and error behavior.
- Do not claim that the customer-assigned `Unfiltered` label disables BytePlus moderation.
- Add no dependency or database migration.
- Do not push or deploy remotely without separate authorization.
- Rebuild Docker with `docker compose up -d --build`; never remove volumes.

---

### Task 1: Resolve Dedicated Aliases and Route Directly

**Files:**
- Modify: `nexoclip-app/src/providers/providerRegistry.js`
- Modify: `nexoclip-app/src/providers/providerRouter.js`
- Modify: `nexoclip-app/tests/providers/providerRegistry.test.mjs`
- Create: `nexoclip-app/tests/providers/byteplusDedicatedEndpoints.test.mjs`

**Interfaces:**
- Produces: `getDirectProvider(model): { provider: string, model: string, endpointEnv?: string } | null`
- Produces: `resolveDirectProviderModel(mapping, env): string`
- Produces: `createBytePlusEndpointNotConfiguredError(model, endpointEnv): Error`
- Consumes: `createProviderRouter({ env, fetch })` and existing BytePlus adapters.

- [ ] **Step 1: Add failing registry tests for dedicated mappings and fail-closed resolution**

Append imports and assertions in `providerRegistry.test.mjs`:

```js
import {
  getDirectProvider,
  resolveDirectProviderModel,
  createBytePlusEndpointNotConfiguredError,
  isRetryableProviderError,
  createDirectProviderUnavailableError,
} from '../../src/providers/providerRegistry.js';

test('maps dedicated BytePlus aliases to environment-backed endpoints', () => {
  const mapping = getDirectProvider('byteplus/seedance-2.0-unfiltered');
  assert.deepEqual(mapping, {
    provider: 'byteplus',
    model: 'byteplus/seedance-2.0-unfiltered',
    endpointEnv: 'BYTEPLUS_SEEDANCE_2_ENDPOINT',
  });
  assert.equal(resolveDirectProviderModel(mapping, {
    BYTEPLUS_SEEDANCE_2_ENDPOINT: ' ep-20260916130459-fw94z ',
  }), 'ep-20260916130459-fw94z');
});

test('fails closed when a dedicated BytePlus endpoint is not configured', () => {
  const mapping = getDirectProvider('byteplus/seedance-2.5-unfiltered');
  assert.throws(
    () => resolveDirectProviderModel(mapping, {}),
    (error) => error.code === 'BYTEPLUS_ENDPOINT_NOT_CONFIGURED'
      && error.status === 503
      && error.endpointEnv === 'BYTEPLUS_SEEDANCE_2_5_ENDPOINT',
  );
});

test('keeps standard BytePlus models on base model ids', () => {
  const mapping = getDirectProvider('dreamina-seedance-2-0-260128');
  assert.equal(mapping.endpointEnv, undefined);
  assert.equal(resolveDirectProviderModel(mapping, {}), 'dreamina-seedance-2-0-260128');
});
```

- [ ] **Step 2: Run the registry test and verify RED**

```bash
cd nexoclip-app
rtk node --test tests/providers/providerRegistry.test.mjs
```

Expected: FAIL because the dedicated mappings and resolver exports do not exist.

- [ ] **Step 3: Implement endpoint-aware direct mappings and resolver**

Add to `DIRECT_MODEL_MAP`:

```js
['byteplus/seedance-2.0-unfiltered', {
  provider: 'byteplus',
  model: 'byteplus/seedance-2.0-unfiltered',
  endpointEnv: 'BYTEPLUS_SEEDANCE_2_ENDPOINT',
}],
['byteplus/seedance-2.5-unfiltered', {
  provider: 'byteplus',
  model: 'byteplus/seedance-2.5-unfiltered',
  endpointEnv: 'BYTEPLUS_SEEDANCE_2_5_ENDPOINT',
}],
['byteplus/seedream-5.0-pro-unfiltered', {
  provider: 'byteplus',
  model: 'byteplus/seedream-5.0-pro-unfiltered',
  endpointEnv: 'BYTEPLUS_SEEDREAM_5_ENDPOINT',
}],
```

Add pure resolution and error helpers:

```js
export function createBytePlusEndpointNotConfiguredError(model, endpointEnv) {
  return Object.assign(
    new Error(`BytePlus endpoint for ${model} is not configured`),
    { code: 'BYTEPLUS_ENDPOINT_NOT_CONFIGURED', status: 503, model, endpointEnv },
  );
}

export function resolveDirectProviderModel(mapping, env = process.env) {
  if (!mapping?.endpointEnv) return mapping?.model;
  const endpoint = env[mapping.endpointEnv]?.trim();
  if (!endpoint) throw createBytePlusEndpointNotConfiguredError(mapping.model, mapping.endpointEnv);
  return endpoint;
}
```

- [ ] **Step 4: Add failing router tests proving direct image/video paths and no fallback**

Create `byteplusDedicatedEndpoints.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRouter } from '../../src/providers/providerRouter.js';

const env = {
  BYTEPLUS_API_KEY: 'byteplus-key',
  BYTEPLUS_BASE_URL: 'https://ark.example/api/v3',
  BYTEPLUS_SEEDANCE_2_ENDPOINT: 'ep-video-20',
  BYTEPLUS_SEEDANCE_2_5_ENDPOINT: 'ep-video-25',
  BYTEPLUS_SEEDREAM_5_ENDPOINT: 'ep-image-50',
};

test('routes dedicated Seedance aliases directly to the video endpoint id', async () => {
  const calls = [];
  const router = createProviderRouter({ env, fetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: 'task-1', status: 'queued' }), { status: 200 });
  } });

  await router.submitVideo({ model: 'byteplus/seedance-2.0-unfiltered', prompt: 'scene' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ark.example/api/v3/contents/generations/tasks');
  assert.equal(calls[0].body.model, 'ep-video-20');
});

test('routes dedicated Seedream alias directly to the image endpoint id', async () => {
  const calls = [];
  const router = createProviderRouter({ env, fetch: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ data: [{ url: 'https://output.example/image.png' }] }), { status: 200 });
  } });

  await router.generateImage({ model: 'byteplus/seedream-5.0-pro-unfiltered', prompt: 'portrait' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ark.example/api/v3/images/generations');
  assert.equal(calls[0].body.model, 'ep-image-50');
});

test('does not call OpenRouter or a base model when endpoint configuration is absent', async () => {
  let calls = 0;
  const router = createProviderRouter({
    env: { BYTEPLUS_API_KEY: 'key', BYTEPLUS_BASE_URL: 'https://ark.example/api/v3' },
    fetch: async () => { calls += 1; return new Response('{}', { status: 200 }); },
  });
  await assert.rejects(
    router.submitVideo({ model: 'byteplus/seedance-2.5-unfiltered', prompt: 'scene' }),
    (error) => error.code === 'BYTEPLUS_ENDPOINT_NOT_CONFIGURED',
  );
  assert.equal(calls, 0);
});
```

- [ ] **Step 5: Run the dedicated routing test and verify RED**

```bash
cd nexoclip-app
rtk node --test tests/providers/byteplusDedicatedEndpoints.test.mjs
```

Expected: FAIL because dedicated aliases still go through OpenRouter or retain their alias as the provider model.

- [ ] **Step 6: Resolve dedicated aliases in the provider router before invoking adapters**

Import `resolveDirectProviderModel`. In `run`, direct-route mappings with `endpointEnv` and use the resolved model:

```js
if (mapping?.provider === 'byteplus' && (mapping.endpointEnv || params.model.startsWith('ep-'))) {
  if (!directConfigured(env, 'byteplus')) {
    throw createDirectProviderUnavailableError(params.model, 'byteplus');
  }
  const adapter = directAdapter(env, 'byteplus', operation, fetchImpl);
  const directParams = { ...params, model: resolveDirectProviderModel(mapping, env) };
  return operation === 'image' ? adapter.generate(directParams) : adapter.submit(directParams);
}
```

Also use `resolveDirectProviderModel(mapping, env)` in `withFallback` so the translation boundary is consistent.

- [ ] **Step 7: Run provider tests**

```bash
cd nexoclip-app
rtk node --test \
  tests/providers/providerRegistry.test.mjs \
  tests/providers/byteplusDedicatedEndpoints.test.mjs \
  tests/providers/byteplusImageFallback.test.mjs \
  tests/providers/byteplusVideoAdapter.test.mjs \
  tests/providers/providerRouterFallback.test.mjs
```

Expected: all pass.

- [ ] **Step 8: Commit provider routing**

```bash
rtk git add \
  nexoclip-app/src/providers/providerRegistry.js \
  nexoclip-app/src/providers/providerRouter.js \
  nexoclip-app/tests/providers/providerRegistry.test.mjs \
  nexoclip-app/tests/providers/byteplusDedicatedEndpoints.test.mjs
rtk git commit -m "feat(byteplus): route dedicated model endpoints"
```

---

### Task 2: Expose Canvas Models and Configure Runtime

**Files:**
- Modify: `nexoclip-app/services/spite/lib/fal-models.ts`
- Create: `nexoclip-app/services/spite/lib/byteplus-endpoint-models.test.ts`
- Modify: `.env.example`
- Modify: `nexoclip-app/.env.example`
- Modify: `nexoclip-app/.env.production.example`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.prod.yml`

**Interfaces:**
- Consumes: application aliases from Task 1.
- Produces: Canvas `ModelConfig` entries and worker environment variables.

- [ ] **Step 1: Add a failing Canvas catalog test**

Create `byteplus-endpoint-models.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { getModelById } from './fal-models'

test('exposes three dedicated BytePlus endpoint models as distinct choices', () => {
  const seedance20 = getModelById('seedance-2.0-unfiltered')
  assert.equal(seedance20?.name, 'Seedance 2.0 Unfiltered')
  assert.equal(seedance20?.providerModel, 'byteplus/seedance-2.0-unfiltered')
  assert.deepEqual(seedance20?.resolutions, ['720p', '1080p'])
  assert.deepEqual(seedance20?.durations, ['5s', '10s', '15s'])

  const seedance25 = getModelById('seedance-2.5-unfiltered')
  assert.equal(seedance25?.name, 'Seedance 2.5 Unfiltered')
  assert.equal(seedance25?.providerModel, 'byteplus/seedance-2.5-unfiltered')

  const seedream = getModelById('seedream-5-pro-unfiltered')
  assert.equal(seedream?.name, 'Seedream 5.0 Pro Unfiltered')
  assert.equal(seedream?.providerModel, 'byteplus/seedream-5.0-pro-unfiltered')
  assert.deepEqual(seedream?.resolutions, ['1K', '2K'])
})

test('preserves standard BytePlus model routes', () => {
  assert.equal(getModelById('seedance-2.0')?.providerModel, 'dreamina-seedance-2-0-260128')
  assert.equal(getModelById('seedance-2.5')?.providerModel, 'dreamina-seedance-2-5-260628')
  assert.equal(getModelById('seedream-5-pro')?.providerModel, 'dola-seedream-5-0-pro-260628')
})
```

- [ ] **Step 2: Run the catalog test and verify RED**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/byteplus-endpoint-models.test.ts
```

Expected: FAIL because the new entries do not exist and the old Seedance 2.5 Unfiltered entry points to a legacy endpoint.

- [ ] **Step 3: Add the three catalog entries**

In `IMAGE_MODELS` add:

```ts
image(
  'seedream-5-pro-unfiltered',
  'Seedream 5.0 Pro Unfiltered',
  'byteplus',
  'byteplus/seedream-5.0-pro-unfiltered',
  SEEDREAM_RATIOS,
  ['1K', '2K'],
  '1:1',
  '1K',
),
```

In `VIDEO_MODELS`, add Seedance 2.0 Unfiltered and update the existing Seedance 2.5 Unfiltered entry:

```ts
video('seedance-2.0-unfiltered', 'Seedance 2.0 Unfiltered', 'byteplus/seedance-2.0-unfiltered', ['720p', '1080p'], ['5s', '10s', '15s']),
video('seedance-2.5-unfiltered', 'Seedance 2.5 Unfiltered', 'byteplus/seedance-2.5-unfiltered', ['480p', '720p', '1080p', '4K'], Array.from({ length: 27 }, (_, i) => `${i + 4}s`)),
```

- [ ] **Step 4: Document and forward endpoint environment variables**

Add to root and app environment examples:

```env
BYTEPLUS_SEEDANCE_2_ENDPOINT=ep-20260916130459-fw94z
BYTEPLUS_SEEDANCE_2_5_ENDPOINT=ep-20260916130618-t2z5j
BYTEPLUS_SEEDREAM_5_ENDPOINT=ep-20260916130838-dkscq
```

Forward all three variables into image and video workers in both Compose files using `${VAR:-}`. The image worker requires Seedream; the video worker requires both Seedance variables. Forward all three to both workers for operational consistency.

- [ ] **Step 5: Run catalog and deployment tests**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/byteplus-endpoint-models.test.ts lib/fal-models.test.ts
cd ../../..
rtk node --test tests/deployment/dockerDeployment.test.mjs nexoclip-app/tests/deployment/dockerDeployment.test.mjs
```

If `lib/fal-models.test.ts` is absent, run only `lib/byteplus-endpoint-models.test.ts`. Expected: all existing tests pass.

- [ ] **Step 6: Commit Canvas catalog and configuration**

```bash
rtk git add \
  nexoclip-app/services/spite/lib/fal-models.ts \
  nexoclip-app/services/spite/lib/byteplus-endpoint-models.test.ts \
  .env.example \
  nexoclip-app/.env.example \
  nexoclip-app/.env.production.example \
  docker-compose.yml \
  docker-compose.prod.yml
rtk git commit -m "feat(canvas): expose dedicated BytePlus models"
```

---

### Task 3: Verify, Review, Merge, and Rebuild Locally

**Files:**
- Modify only files required by regressions caused by Tasks 1–2.

**Interfaces:**
- Produces: verified local `main` and refreshed Docker runtime.

- [ ] **Step 1: Run all relevant main-app provider tests**

```bash
cd nexoclip-app
rtk node --test tests/providers/*.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Run complete Spite tests and build**

```bash
cd nexoclip-app/services/spite
rtk npm test
rtk npm run build
```

Expected: zero failures and successful production build. Restore generated `next-env.d.ts` changes if Next rewrites them.

- [ ] **Step 3: Run main-app generation and deployment regression tests**

```bash
cd nexoclip-app
rtk node --test tests/generations/*.test.mjs tests/deployment/*.test.mjs
cd ..
rtk node --test tests/deployment/*.test.mjs
```

Expected: zero feature-caused failures.

- [ ] **Step 4: Review scope**

```bash
rtk proxy git diff --check
rtk git status --short
```

Review fail-closed behavior, no OpenRouter fallback for dedicated aliases, standard model preservation, worker env forwarding, and absence of secrets.

- [ ] **Step 5: Fast-forward into local main after approval**

```bash
rtk git merge --ff-only <feature-branch>
```

- [ ] **Step 6: Rebuild Docker without removing volumes**

```bash
rtk docker compose up -d --build
```

- [ ] **Step 7: Verify runtime configuration and health without printing API keys**

```bash
rtk docker compose ps
rtk docker exec nexoclip-nexoclip-image-worker-1 node -e 'for (const k of ["BYTEPLUS_SEEDREAM_5_ENDPOINT"]) console.log(k, Boolean(process.env[k]))'
rtk docker exec nexoclip-nexoclip-video-worker-1 node -e 'for (const k of ["BYTEPLUS_SEEDANCE_2_ENDPOINT", "BYTEPLUS_SEEDANCE_2_5_ENDPOINT"]) console.log(k, Boolean(process.env[k]))'
rtk curl http://localhost/spite/healthz
```

Expected: services healthy/running, all endpoint booleans are `true`, and health returns `{"ok":true}`.

- [ ] **Step 8: Manual smoke test**

Submit one low-cost generation per dedicated model. Confirm the durable job stores the stable application alias while the BytePlus request payload contains the corresponding `ep-...` endpoint ID. A provider moderation rejection is a valid provider outcome and must display as failure, never trigger a base-model fallback.
