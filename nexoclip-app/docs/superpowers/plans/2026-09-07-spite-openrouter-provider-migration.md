# SPITE OpenRouter Provider Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SPITE's fal.ai transport with OpenRouter-first image/video generation and explicit Google, OpenAI, and BytePlus direct fallbacks while preserving the current model UI, cost table, R2 persistence, and Neon persistence.

**Architecture:** Add a SPITE-local provider boundary under `services/spite/lib/providers/`, based on the proven root `src/providers/` adapters. Convert the existing SPITE model registry into provider-neutral metadata with explicit OpenRouter IDs and route generation through one router that records which provider owns each async job.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.7, Node built-in test runner with `tsx`, OpenRouter REST APIs, Google Generative Language API, OpenAI APIs, BytePlus Ark APIs, Neon Postgres, Cloudflare R2.

## Global Constraints

- OpenRouter is the primary generation provider.
- Direct fallback is limited to explicit mappings for Google/Gemini, OpenAI, and BytePlus.
- Models without a verified direct mapping remain OpenRouter-only and fail clearly if OpenRouter cannot serve them.
- Existing model presentation and `lib/fal-cost.ts` estimates remain unchanged during this migration.
- Existing R2 output persistence, Neon metadata persistence, authentication, and canvas behavior remain unchanged.
- `FAL_KEY` must be removed from required setup and runtime generation paths.
- Provider secrets remain server-only and must never appear in logs, responses, snapshots, or commits.
- Preserve unrelated working-tree changes.

---

### Task 1: Add a runnable provider test harness and OpenRouter adapters

**Files:**
- Modify: `services/spite/package.json`
- Create: `services/spite/lib/providers/openrouter/image-adapter.ts`
- Create: `services/spite/lib/providers/openrouter/video-adapter.ts`
- Create: `services/spite/lib/providers/provider-types.ts`
- Create: `services/spite/lib/providers/openrouter/openrouter-adapters.test.ts`

**Interfaces:**
- Produces: `createOpenRouterImageAdapter(options)`, `createOpenRouterVideoAdapter(options)`, `ProviderError`, `ImageGenerationResult`, `VideoSubmitResult`, and `VideoStatusResult`.
- Consumes: `OPENROUTER_API_KEY` only through callers; adapters receive credentials by dependency injection.

- [ ] **Step 1: Add the test command and test runtime**

Add `tsx` as a dev dependency and this script:

```json
"test": "tsx --test \"lib/**/*.test.ts\""
```

Run:

```bash
rtk npm --prefix services/spite install
```

- [ ] **Step 2: Write failing image-adapter tests**

Cover these exact behaviors using an injected fake `fetch`:

```ts
test('POSTs an image request to OpenRouter and normalizes URL output', async () => {
  // Assert URL: https://openrouter.ai/api/v1/images
  // Assert Authorization: Bearer test-key
  // Assert body model, prompt, aspect_ratio, resolution, and input_references.
  // Return { id: 'img-1', data: [{ url: 'https://cdn.test/out.png' }] }.
  // Assert provider=openrouter, status=succeeded, providerRequestId=img-1.
})

test('normalizes OpenRouter base64 image output', async () => {
  // Return { data: [{ b64_json: 'YWJj', media_type: 'image/webp' }] }.
  // Assert data:image/webp;base64,YWJj.
})

test('returns a safe normalized error without leaking response text', async () => {
  // Return HTTP 401 containing a fake secret.
  // Assert code OPENROUTER_AUTHENTICATION_FAILED and that message omits it.
})
```

- [ ] **Step 3: Run image tests and verify RED**

Run:

```bash
rtk npm --prefix services/spite test -- lib/providers/openrouter/openrouter-adapters.test.ts
```

Expected: failure because the adapters do not exist.

- [ ] **Step 4: Implement the minimal OpenRouter image adapter**

Implement validation, `POST /api/v1/images`, Bearer auth, request mapping, URL/base64 normalization, usage normalization, and safe errors. Do not import application state into the adapter.

- [ ] **Step 5: Write failing video-adapter tests**

Cover:

```ts
test('submits video and preserves OpenRouter job identity', async () => {
  // Assert POST /api/v1/videos and normalized { provider, id, status }.
})

test('polls and downloads video content by encoded job id', async () => {
  // Assert GET /api/v1/videos/<id> and /content?index=0.
})

test('maps image and video references to OpenRouter input_references', async () => {
  // Assert image_url and video_url reference objects.
})
```

- [ ] **Step 6: Run video tests and verify RED**

Run the same focused test command. Expected: missing video adapter exports.

- [ ] **Step 7: Implement the minimal OpenRouter video adapter**

Implement `submit`, `poll`, and `downloadContent` with the normalized types. Preserve OpenRouter's async job ID and status; never infer a fal endpoint.

- [ ] **Step 8: Run tests and commit**

```bash
rtk npm --prefix services/spite test -- lib/providers/openrouter/openrouter-adapters.test.ts
rtk git add services/spite/package.json services/spite/pnpm-lock.yaml services/spite/lib/providers
rtk git commit -m "feat(spite): add OpenRouter adapters"
```

Expected: all focused adapter tests pass.

---

### Task 2: Add explicit direct-provider fallback routing

**Files:**
- Create: `services/spite/lib/providers/direct/image-adapters.ts`
- Create: `services/spite/lib/providers/direct/openai-video-adapter.ts`
- Create: `services/spite/lib/providers/direct/byteplus-video-adapter.ts`
- Create: `services/spite/lib/providers/provider-registry.ts`
- Create: `services/spite/lib/providers/provider-router.ts`
- Create: `services/spite/lib/providers/provider-router.test.ts`
- Modify: `services/spite/package.json`

**Interfaces:**
- Consumes: normalized adapter interfaces from Task 1 and environment keys `OPENROUTER_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `OPENAI_API_KEY`, `BYTEPLUS_API_KEY`, `BYTEPLUS_BASE_URL`.
- Produces: `createProviderRouter({ env, fetch })` exposing `generateImage`, `submitVideo`, `pollVideo`, `downloadVideo`, and `cancelVideo`.
- Produces: `getDirectProvider(model)` and `isRetryableProviderError(error)`.

- [ ] **Step 1: Add the existing direct-adapter runtime requirement**

Add `sharp` to SPITE dependencies because OpenAI Sora reference images must be resized to an accepted frame size before direct submission:

```bash
rtk npm --prefix services/spite install sharp
```

- [ ] **Step 2: Write failing routing-policy tests**

```ts
test('uses OpenRouter first', async () => {
  // Primary succeeds; assert direct fetch was never called.
})

test('falls back once for an explicitly mapped model on retryable failure', async () => {
  // OpenRouter returns 503 for openai/gpt-image-2.
  // Assert one direct OpenAI request and provider=openai.
})

test('does not fallback on invalid input', async () => {
  // OpenRouter returns 422; assert no direct request.
})

test('does not fallback for an unmapped model', async () => {
  // OpenRouter returns 503 for kwaivgi/kling-v3.0-pro; assert propagated safe error.
})

test('requires the mapped direct provider credentials before fallback', async () => {
  // Omit OPENAI_API_KEY; assert DIRECT_PROVIDER_UNAVAILABLE with status 503.
})

test('polls and downloads using the provider returned at submission', async () => {
  // Assert a BytePlus job never reaches OpenRouter poll/download methods.
})
```

- [ ] **Step 3: Run router tests and verify RED**

```bash
rtk npm --prefix services/spite test -- lib/providers/provider-router.test.ts
```

Expected: failure because the router and registry do not exist.

- [ ] **Step 4: Port only the required direct adapters**

Port and type the existing behavior from:

```text
src/providers/direct/imageAdapters.js
src/providers/direct/openaiVideoAdapter.js
src/providers/direct/byteplusAdapter.js
```

Keep their current provider request contracts. Do not add a direct implementation for unsupported vendors.

- [ ] **Step 5: Implement the explicit fallback registry**

Start with the verified root mappings that overlap SPITE models:

```ts
const DIRECT_MODEL_MAP = new Map([
  ['openai/gpt-image-2', { provider: 'openai', model: 'gpt-image-2' }],
  ['openai/sora-2-pro', { provider: 'openai', model: 'sora-2-pro' }],
  ['bytedance-seed/seedream-5-0-pro', { provider: 'byteplus', model: 'dola-seedream-5-0-pro-260628' }],
  ['bytedance/seedance-2.0', { provider: 'byteplus', model: 'dreamina-seedance-2-0-260128' }],
])
```

Also support Google image mappings only when a SPITE model maps to a confirmed `google/*` OpenRouter identifier. No prefix-based fallback for unknown models.

- [ ] **Step 6: Implement single-attempt fallback routing**

Retry only for network errors, 408, 409, 429, 5xx, OpenRouter model-unavailable 400, and authorization-routing 403. Return `provider` with async submissions and require that same provider for poll/download/cancel.

- [ ] **Step 7: Run tests and commit**

```bash
rtk npm --prefix services/spite test -- lib/providers/provider-router.test.ts
rtk npm --prefix services/spite test
rtk git add services/spite/package.json services/spite/pnpm-lock.yaml services/spite/lib/providers
rtk git commit -m "feat(spite): add direct provider fallback"
```

---

### Task 3: Make the model registry provider-neutral

**Files:**
- Rename: `services/spite/lib/fal-models.ts` → `services/spite/lib/generation-models.ts`
- Rename: `services/spite/lib/fal-cost.ts` → `services/spite/lib/generation-cost.ts`
- Create: `services/spite/lib/generation-models.test.ts`
- Modify: every import of `@/lib/fal-models` and `@/lib/fal-cost` under `services/spite/`

**Interfaces:**
- Produces: `ModelConfig.openRouterModel?: string`, `getModelById`, `getModelsByCategory`, `getImageModels`, `getVideoModels`, and `buildModelInput`.
- Consumes: the current model metadata and unchanged numeric price entries.

- [ ] **Step 1: Write failing model-mapping tests**

Assert the migrated registry maps confirmed models exactly:

```ts
assert.equal(getModelById('nano-banana-2')?.openRouterModel, 'google/gemini-3.1-flash-image')
assert.equal(getModelById('nano-banana-pro')?.openRouterModel, 'google/gemini-3-pro-image')
assert.equal(getModelById('gpt-image-2')?.openRouterModel, 'openai/gpt-image-2')
assert.equal(getModelById('flux-2-pro')?.openRouterModel, 'black-forest-labs/flux.2-pro')
assert.equal(getModelById('seedance-2.0')?.openRouterModel, 'bytedance/seedance-2.0')
```

Also iterate over all models and reject any `openRouterModel` beginning with `fal-ai/` or containing `/text-to-video`, `/image-to-video`, or `/reference-to-video` legacy endpoint suffixes.

- [ ] **Step 2: Run mapping tests and verify RED**

```bash
rtk npm --prefix services/spite test -- lib/generation-models.test.ts
```

Expected: missing provider-neutral registry/module.

- [ ] **Step 3: Rename registry and cost modules without changing UI metadata or prices**

Replace the provider field with:

```ts
openRouterModel?: string
```

Use only confirmed mappings from `packages/studio/src/models.js`. Models lacking a confirmed mapping keep `openRouterModel` undefined and return a clear `MODEL_UNAVAILABLE` response before spend reservation.

- [ ] **Step 4: Adapt request input into provider-neutral parameters**

Keep `buildModelInput` temporarily for UI compatibility, but add a narrow conversion at the provider boundary:

```ts
{
  model: model.openRouterModel,
  prompt,
  aspectRatio,
  resolution,
  duration,
  generateAudio,
  frameImages,
  referenceImages,
  referenceVideos,
}
```

Do not forward fal.ai-only field names to OpenRouter.

- [ ] **Step 5: Run tests, typecheck, and commit**

```bash
rtk npm --prefix services/spite test
rtk npx tsc -p services/spite/tsconfig.json --noEmit
rtk git add services/spite/lib services/spite/app services/spite/components
rtk git commit -m "refactor(spite): neutralize model registry"
```

---

### Task 4: Migrate generation routes and persistent job metadata

**Files:**
- Modify: `services/spite/app/api/generate/submit/route.ts`
- Modify: `services/spite/app/api/generate/status/route.ts`
- Modify: `services/spite/app/api/generate/cancel/route.ts`
- Modify: `services/spite/app/api/generate/recover/route.ts`
- Rename: `services/spite/lib/fal-validate.ts` → `services/spite/lib/provider-validate.ts`
- Delete: `services/spite/lib/fal-voices.ts`
- Create: `services/spite/app/api/generate/generation-routes.test.ts`
- Modify: `services/spite/components/canvas/nodes/image-node.tsx`
- Modify: `services/spite/components/canvas/nodes/video-node.tsx`
- Modify: `services/spite/components/canvas/canvas-workspace.tsx`
- Modify: `services/spite/components/canvas/nodes/node-toolbar.tsx`

**Interfaces:**
- Submit response remains compatible with current consumers:

```ts
{
  request_id: string,
  provider: 'openrouter' | 'google' | 'openai' | 'byteplus',
  model: string,
  modelId: string,
  category: 'image' | 'video',
  status?: 'COMPLETED'
}
```

- Pending canvas metadata becomes `pendingProvider`, `pendingProviderModel`, `pendingRequestId`, and `pendingStartedAt`.
- Legacy `pendingFalEndpoint` is read only for backward-compatible cleanup and is never submitted to a provider.

- [ ] **Step 1: Write failing route contract tests**

Cover:

```ts
test('rejects missing OPENROUTER_API_KEY before reserving spend')
test('rejects models without an OpenRouter mapping before reserving spend')
test('returns provider identity with a submitted video job')
test('returns completed normalized output for synchronous images')
test('polls using the recorded provider instead of a client-controlled URL')
test('rejects invalid provider and request identifiers')
test('rolls back spend after a failed submit or terminal failed poll')
```

Use injected adapter/router functions or module-level test seams; never call billable provider endpoints.

- [ ] **Step 2: Run route tests and verify RED**

```bash
rtk npm --prefix services/spite test -- app/api/generate/generation-routes.test.ts
```

Expected: old fal.ai contracts and key checks fail the assertions.

- [ ] **Step 3: Migrate submit**

Replace direct `queue.fal.run` calls with `createProviderRouter().generateImage(...)` or `.submitVideo(...)`. Images may complete in the submit response; videos return an async job. Keep spend reservation and rollback semantics unchanged.

Remove Kling fal.ai voice cloning. If a request contains `audioUrl` or `voiceIds` for an unsupported provider path, return status 422 before reserving spend with a clear unsupported-feature message.

- [ ] **Step 4: Migrate status, cancel, and recovery**

Use provider identity plus model/job ID, not interpolated URLs. Normalize statuses to `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`, and `FAILED` for current UI compatibility. For providers without cancellation, return status 409 and `Cancellation is not supported by this provider`. Recovery supports async video providers; synchronous image jobs require no recovery.

- [ ] **Step 5: Migrate persisted canvas fields**

Write `pendingProvider` and `pendingProviderModel`. On hydration, accept old `pendingFalEndpoint` only to clear obsolete state and show a recovery-unavailable message; do not send it to OpenRouter.

- [ ] **Step 6: Run tests and commit**

```bash
rtk npm --prefix services/spite test
rtk npx tsc -p services/spite/tsconfig.json --noEmit
rtk git add services/spite/app/api/generate services/spite/components/canvas services/spite/lib
rtk git commit -m "feat(spite): route generation via OpenRouter"
```

---

### Task 5: Replace fal.ai setup and status UI

**Files:**
- Modify: `services/spite/lib/env-check.ts`
- Modify: `services/spite/.env.example`
- Modify: `services/spite/app/setup/page.tsx`
- Modify: `services/spite/app/api/generate/test/route.ts`
- Delete: `services/spite/app/api/fal/balance/route.ts`
- Rename: `services/spite/components/canvas/fal-balance-badge.tsx` → `services/spite/components/canvas/provider-status-badge.tsx`
- Modify: `services/spite/components/canvas/canvas-toolbar.tsx`
- Modify: `services/spite/app/settings/page.tsx`
- Modify: `services/spite/app/m/project/[id]/page.tsx`
- Modify: `services/spite/components/onboarding/steps.ts`
- Modify: `services/spite/README.md`
- Create: `services/spite/lib/env-check.test.ts`

**Interfaces:**
- `checkRequiredEnv()` requires `OPENROUTER_API_KEY` instead of `FAL_KEY`.
- `/api/generate/test` remains non-billable and reports configured provider names without validating by generating media.
- `ProviderStatusBadge` reports configured/unconfigured state; it does not claim to show account balance.

- [ ] **Step 1: Write failing environment tests**

```ts
test('requires OPENROUTER_API_KEY')
test('does not require FAL_KEY')
test('treats direct provider credentials as optional')
test('reports only missing required keys')
```

Save and restore `process.env` around each test.

- [ ] **Step 2: Run environment tests and verify RED**

```bash
rtk npm --prefix services/spite test -- lib/env-check.test.ts
```

Expected: current checker requires `FAL_KEY` and ignores `OPENROUTER_API_KEY`.

- [ ] **Step 3: Replace environment configuration**

Use this `.env.example` provider section:

```dotenv
# Primary generation provider
OPENROUTER_API_KEY=""

# Optional direct fallbacks
GEMINI_API_KEY=""
OPENAI_API_KEY=""
BYTEPLUS_API_KEY=""
BYTEPLUS_BASE_URL=""
```

Only `OPENROUTER_API_KEY` is part of `REQUIRED_ENV_VARS`.

- [ ] **Step 4: Replace provider status UI and documentation**

Rename fal.ai labels, comments, and error copy. The status endpoint returns masked presence only:

```json
{
  "connected": true,
  "primary": "openrouter",
  "fallbacks": ["google", "openai", "byteplus"],
  "note": "Credential presence verified. Validity is confirmed on generation."
}
```

Include only fallbacks whose full credential requirements are present. Remove the fal balance request and dollar-balance claim.

- [ ] **Step 5: Remove remaining runtime fal.ai references**

Run:

```bash
rtk rg -n "queue\.fal\.run|FAL_KEY|@fal-ai/client|/api/fal/" services/spite/app services/spite/components services/spite/lib services/spite/README.md services/spite/.env.example
```

Expected: no runtime/config references. Historical migration comments may be rewritten to provider-neutral wording rather than retained.

- [ ] **Step 6: Run tests and commit**

```bash
rtk npm --prefix services/spite test
rtk npx tsc -p services/spite/tsconfig.json --noEmit
rtk git add services/spite/.env.example services/spite/README.md services/spite/app services/spite/components services/spite/lib
rtk git commit -m "refactor(spite): remove fal integration"
```

---

### Task 6: Final verification without billable requests

**Files:**
- Modify only files required by failures discovered during verification.

**Interfaces:**
- Consumes: complete migrated service.
- Produces: verification evidence; no new runtime API.

- [ ] **Step 1: Confirm secrets are absent from tracked changes**

```bash
rtk git diff --cached
rtk git diff
rtk rg -n "npg_|OPENROUTER_API_KEY=. +|FAL_KEY=. +" services/spite --glob '!*.env' --glob '!*.env.local'
```

Expected: no credentials in tracked files. Correct spacing in the final `rg` invocation if the shell treats the example literally: search populated key assignments, not placeholder names.

- [ ] **Step 2: Run the full automated suite**

```bash
rtk npm --prefix services/spite test
```

Expected: zero failing tests.

- [ ] **Step 3: Run static checks**

```bash
rtk npx tsc -p services/spite/tsconfig.json --noEmit
rtk npm --prefix services/spite run lint
rtk npm --prefix services/spite run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Smoke-test non-billable routes**

Start SPITE with its local env, then verify:

```bash
rtk curl -i -X POST http://localhost:3005/api/generate/test
rtk curl -i -X POST -H 'content-type: application/json' \
  --data '{"modelId":"not-a-real-model","prompt":"test"}' \
  http://localhost:3005/api/generate/submit
```

Expected: provider status contains no secret; invalid model returns 400 without contacting any provider or reserving spend.

- [ ] **Step 5: Review the final diff and commit verification fixes if any**

```bash
rtk git status
rtk git diff
```

Confirm unrelated changes remain untouched, especially `Seedance2.0 Model Card.pdf` and unrelated untracked services. If verification required fixes, commit only those SPITE paths:

```bash
rtk git add services/spite
rtk git commit -m "fix(spite): finish provider migration"
```
