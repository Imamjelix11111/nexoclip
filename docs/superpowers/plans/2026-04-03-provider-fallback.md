# Backend Provider Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat semua route AI backend mencoba OpenRouter lebih dulu lalu fallback ke provider direct pemilik model saat kegagalan transient.

**Architecture:** Tambahkan provider registry/router terpusat di `src/providers`, dengan adapter direct yang mengembalikan kontrak hasil yang sama dengan adapter OpenRouter. Route image/video memakai router saat submit; route polling video menyimpan dan membaca provider yang dipilih dari job params sehingga tidak mencoba provider lain atau membuat job duplikat.

**Tech Stack:** Next.js 15 App Router, JavaScript ESM, native `fetch`, Node test runner/Vitest-compatible existing `.mjs` tests, environment variables.

## Global Constraints

- Primary provider selalu OpenRouter jika `OPENROUTER_API_KEY` tersedia.
- Fallback hanya untuk network failure, timeout, HTTP 408, 409, 429, dan HTTP 5xx.
- Jangan fallback untuk authentication, authorization, invalid request, missing model, content policy, atau error client lain.
- Model tanpa direct mapping harus gagal dengan `DIRECT_PROVIDER_UNAVAILABLE`; tidak boleh mengganti model.
- Direct Gemini memakai `GEMINI_API_KEY`; direct OpenAI memakai `OPENAI_API_KEY`; BytePlus memakai `BYTEPLUS_API_KEY` dan `BYTEPLUS_BASE_URL`.
- Jangan log API key, prompt sensitif, atau credential response.
- Async image/video fallback hanya terjadi pada submit awal; polling/download mengikuti provider dan ID job yang sudah dipilih.
- Jangan mengubah perubahan user yang sudah ada: `Seedance2.0 Model Card.pdf` dan untracked service files.

---

### Task 1: Lock provider mapping and fallback policy with tests

**Files:**
- Create: `nexoclip-app/src/providers/providerRegistry.js`
- Create: `nexoclip-app/tests/providers/providerRegistry.test.mjs`

**Interfaces:**
- Produces `getDirectProvider(model) -> { provider, model } | null`.
- Produces `isRetryableProviderError(error) -> boolean`.
- Produces `createDirectProviderUnavailableError(model, provider) -> Error` with `code`, `status`, `model`, and `provider` fields.

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDirectProvider,
  isRetryableProviderError,
  createDirectProviderUnavailableError,
} from '../../src/providers/providerRegistry.js';

test('maps Gemini, OpenAI, and BytePlus model IDs without changing model name', () => {
  assert.deepEqual(getDirectProvider('google/gemini-2.5-pro'), { provider: 'gemini', model: 'gemini-2.5-pro' });
  assert.deepEqual(getDirectProvider('openai/gpt-4o'), { provider: 'openai', model: 'gpt-4o' });
  assert.deepEqual(getDirectProvider('bytedance/seedance-1-0'), { provider: 'byteplus', model: 'seedance-1-0' });
  assert.equal(getDirectProvider('anthropic/claude-3-7-sonnet'), null);
});

test('only classifies transient failures as retryable', () => {
  for (const status of [408, 409, 429, 500, 502, 503, 504]) assert.equal(isRetryableProviderError({ status }), true);
  assert.equal(isRetryableProviderError({ status: 401 }), false);
  assert.equal(isRetryableProviderError({ status: 400 }), false);
  assert.equal(isRetryableProviderError(new TypeError('fetch failed')), true);
});

test('creates safe unsupported direct provider error', () => {
  const error = createDirectProviderUnavailableError('unknown/model', null);
  assert.equal(error.code, 'DIRECT_PROVIDER_UNAVAILABLE');
  assert.equal(error.status, 503);
  assert.equal(error.model, 'unknown/model');
  assert.match(error.message, /fallback direct provider/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexoclip-app && node --test tests/providers/providerRegistry.test.mjs`
Expected: FAIL because `providerRegistry.js` does not exist.

- [ ] **Step 3: Implement the registry**

Use explicit prefixes (`google/`, `openai/`, `bytedance/`, plus direct-name prefixes only when unambiguous) and strip only the OpenRouter namespace prefix. Preserve direct model names exactly after the prefix. Treat `TypeError`/network errors as retryable, and expose no secret data in generated errors.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nexoclip-app && node --test tests/providers/providerRegistry.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd nexoclip-app && git add src/providers/providerRegistry.js tests/providers/providerRegistry.test.mjs && git commit -m "feat: add provider fallback registry"
```

---

### Task 2: Add direct OpenAI-compatible adapters

**Files:**
- Create: `nexoclip-app/src/providers/direct/openaiAdapter.js`
- Create: `nexoclip-app/src/providers/direct/byteplusAdapter.js`
- Create: `nexoclip-app/src/providers/direct/geminiAdapter.js`
- Create: `nexoclip-app/tests/providers/directAdapters.test.mjs`

**Interfaces:**
- Each factory accepts `{ apiKey, baseUrl, fetch }` and exposes `generate`, `submit`, `poll`, and `downloadContent` only for operations supported by that provider.
- Text direct adapters normalize provider errors to `{ code, status, message, provider }`.
- Image/video adapters return the same normalized shapes currently consumed by `openrouter/images` and `openrouter/videos`.

- [ ] **Step 1: Write failing adapter contract tests**

Test successful OpenAI-compatible JSON request headers/body, BytePlus base URL usage, Gemini URL/key usage, and normalization of non-2xx responses. Assert that API keys occur only in request headers/query and never in thrown messages.

- [ ] **Step 2: Run the focused tests**

Run: `cd nexoclip-app && node --test tests/providers/directAdapters.test.mjs`
Expected: FAIL because direct adapters do not exist.

- [ ] **Step 3: Implement minimal adapters**

Use native `fetch`, trim trailing slashes, use OpenAI-compatible `/chat/completions` for OpenAI/BytePlus, and Gemini’s REST `models/{model}:generateContent?key=...` endpoint for Gemini. Keep operation-specific unsupported cases explicit instead of silently translating incompatible image/video APIs.

- [ ] **Step 4: Run focused tests**

Run: `cd nexoclip-app && node --test tests/providers/directAdapters.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd nexoclip-app && git add src/providers/direct tests/providers/directAdapters.test.mjs && git commit -m "feat: add direct provider adapters"
```

---

### Task 3: Implement centralized operation router

**Files:**
- Create: `nexoclip-app/src/providers/providerRouter.js`
- Create: `nexoclip-app/tests/providers/providerRouter.test.mjs`

**Interfaces:**
- `createProviderRouter({ env, adapters, openrouter })` returns `generate(params)`, `submit(params)`, `poll(provider, jobId)`, and `downloadContent(provider, jobId, index)`.
- Router result includes `provider` so async callers can persist it.

- [ ] **Step 1: Write failing tests**

Cover: OpenRouter success means one call; transient OpenRouter error calls only mapped direct adapter; permanent OpenRouter error does not fallback; unknown model returns `DIRECT_PROVIDER_UNAVAILABLE`; missing direct credentials returns a safe 503 configuration error; direct failure preserves safe normalized error.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cd nexoclip-app && node --test tests/providers/providerRouter.test.mjs`
Expected: FAIL because router does not exist.

- [ ] **Step 3: Implement router**

Inject adapters for deterministic tests. Check primary key before constructing OpenRouter. On a retryable primary error, resolve the direct mapping and credential configuration, then invoke only that direct provider. Never retry a request after a provider has returned a non-transient client error.

- [ ] **Step 4: Run focused tests**

Run: `cd nexoclip-app && node --test tests/providers/providerRouter.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd nexoclip-app && git add src/providers/providerRouter.js tests/providers/providerRouter.test.mjs && git commit -m "feat: route AI requests with provider fallback"
```

---

### Task 4: Integrate image and video submit routes

**Files:**
- Modify: `nexoclip-app/app/api/openrouter/images/route.js`
- Modify: `nexoclip-app/app/api/openrouter/videos/route.js`
- Create or modify: `nexoclip-app/tests/api/providerFallbackRoutes.test.mjs`

**Interfaces:**
- Existing exported `createImageHandler` and `createVideoSubmitHandler` remain injectable and backward-compatible for tests.
- Default `generate`/`submitVideo` call `createProviderRouter({ env })`.

- [ ] **Step 1: Add route tests**

Assert routes no longer require `OPENROUTER_API_KEY` when a direct fallback configuration is present, pass model and operation parameters to the router, return `provider`-normalized output, and persist video job params including `provider`.

- [ ] **Step 2: Run route tests to establish failure**

Run: `cd nexoclip-app && node --test tests/api/providerFallbackRoutes.test.mjs`
Expected: FAIL against current OpenRouter-only guard/default adapter.

- [ ] **Step 3: Integrate router and preserve response shape**

Remove OpenRouter-only availability guards. Return `DIRECT_PROVIDER_UNAVAILABLE` or provider configuration errors with their status/code. For video, persist `providerId`, `provider`, and model in job params. For image, preserve existing output persistence and job tracking behavior.

- [ ] **Step 4: Run route tests**

Run: `cd nexoclip-app && node --test tests/api/providerFallbackRoutes.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd nexoclip-app && git add app/api/openrouter/images/route.js app/api/openrouter/videos/route.js tests/api/providerFallbackRoutes.test.mjs && git commit -m "feat: enable image and video provider fallback"
```

---

### Task 5: Make video polling provider-aware

**Files:**
- Modify: `nexoclip-app/app/api/openrouter/videos/[id]/route.js`
- Modify: `nexoclip-app/tests/api/providerFallbackRoutes.test.mjs`

**Interfaces:**
- Poll route reads `provider` from the authorized job params when available and uses the matching adapter/base URL.
- Existing `GET /api/openrouter/videos/:id` response shape remains unchanged.

- [ ] **Step 1: Write failing polling test**

Create a job with `provider: 'byteplus'`, mock OpenRouter and BytePlus poll/download adapters, and assert only BytePlus is called for both operations. Add a missing-provider case that returns a clear provider error rather than probing another provider.

- [ ] **Step 2: Run focused test**

Run: `cd nexoclip-app && node --test tests/api/providerFallbackRoutes.test.mjs`
Expected: FAIL because polling always constructs OpenRouter adapter.

- [ ] **Step 3: Implement provider-aware polling**

Use existing job lookup/access controls. Use persisted provider metadata as source of truth; retain an explicit OpenRouter default only for legacy jobs that lack provider metadata. Do not fallback during poll or download.

- [ ] **Step 4: Run focused test**

Run: `cd nexoclip-app && node --test tests/api/providerFallbackRoutes.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd nexoclip-app && git add app/api/openrouter/videos/[id]/route.js tests/api/providerFallbackRoutes.test.mjs && git commit -m "feat: persist video provider for polling"
```

---

### Task 6: Audit and integrate remaining backend AI entry points

**Files:**
- Modify: all remaining `nexoclip-app/app/api/**` routes that directly instantiate an OpenRouter adapter or call OpenRouter for model inference.
- Modify: relevant existing route tests.
- Modify: `nexoclip-app/.env.example` and backend documentation if required.

**Interfaces:**
- Every text/chat/image/video AI submit path uses `providerRouter`; non-provider routes (MuAPI, local inference, storage, auth) remain unchanged.

- [ ] **Step 1: Inventory direct calls**

Run: `cd nexoclip-app && rg -n "OPENROUTER|createOpenRouter|openrouter.ai|/api/v1/(chat|responses|images|videos)" app src services --glob '!**/node_modules/**' --glob '!**/.next/**'` and classify each hit as AI submit, polling/download, or unrelated proxy.

- [ ] **Step 2: Add one regression test per remaining AI submit route**

Mock primary transient failure and mapped direct success. Assert unsupported model and permanent error behavior. Do not add tests for unrelated MuAPI/OpenRouter passthrough routes unless they own model execution.

- [ ] **Step 3: Integrate each classified submit route**

Replace direct OpenRouter construction with the centralized router while keeping existing auth, tenancy, billing, persistence, and public response contracts intact.

- [ ] **Step 4: Update configuration docs**

Document `GEMINI_API_KEY`, `OPENAI_API_KEY`, `BYTEPLUS_API_KEY`, `BYTEPLUS_BASE_URL`, and fallback behavior without including values.

- [ ] **Step 5: Run regression tests**

Run: `cd nexoclip-app && node --test tests/providers tests/api`
Expected: PASS for all provider and API tests.

- [ ] **Step 6: Commit**

```bash
cd nexoclip-app && git add app src tests .env.example README.md && git commit -m "feat: apply fallback across backend AI routes"
```

---

### Task 7: Full verification and review

**Files:**
- No intended source changes; only fix failures found in the files above.

- [ ] **Step 1: Run focused provider tests**

Run: `cd nexoclip-app && node --test tests/providers tests/api/providerFallbackRoutes.test.mjs`
Expected: PASS.

- [ ] **Step 2: Run the complete existing test suite**

Run: `cd nexoclip-app && npm test -- --runInBand` if the repository exposes `test`, otherwise run `node --test tests/**/*.test.mjs tests/**/*.test.js` using the project’s configured test command.
Expected: no regressions.

- [ ] **Step 3: Run lint/build verification**

Run: `cd nexoclip-app && npm run lint && npm run build`
Expected: lint and production build complete successfully.

- [ ] **Step 4: Review diff for secret leakage and scope**

Run: `rtk git diff --check` and inspect `rtk git diff --stat`; confirm no environment values, prompt logs, unrelated service files, or user PDF changes are staged.

- [ ] **Step 5: Commit only fixes if needed**

```bash
cd nexoclip-app && git add <verified-fix-files> && git commit -m "fix: harden provider fallback integration"
```
