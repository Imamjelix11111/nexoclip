# OpenRouter Image Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Image Studio text-to-image and image-to-image generation from MuAPI to OpenRouter without fallback, while keeping the frontend model catalog static and showing only models with valid OpenRouter image-model mappings.

**Architecture:** Keep the existing static model definitions in `packages/studio/src/models.js`, add a centralized frontend-ID-to-OpenRouter-slug mapping, and derive filtered T2I/I2I catalogs for Image Studio. Route all Image Studio generation and upload requests through Next.js server routes using `OPENROUTER_API_KEY`; translate MuAPI-shaped UI parameters into OpenRouter's `/api/v1/images` contract and normalize base64 responses to data URLs. MuAPI remains available to non-Image-Studio features but is not used by Image Studio generation.

**Tech Stack:** Next.js App Router, JavaScript ES modules, React, Node test runner (`node:test`), OpenRouter Image API.

## Global Constraints

- Image Studio generation is OpenRouter-only; no MuAPI fallback.
- Model choices remain static in the frontend.
- A frontend model is visible only when it has an explicit valid OpenRouter image-model mapping.
- `OPENROUTER_API_KEY` must remain server-side and must never be exposed to browser code.
- Text-to-image and image-to-image are in scope; video, audio, clipping, recast, workflow, and other studios are out of scope.
- Existing MuAPI adapter and non-Image-Studio features must remain unchanged.
- Generated base64 output must be normalized to a browser-consumable data URL for the first MVP; persistent object-storage upload is out of scope for this change.

---

### Task 1: Add failing tests for the OpenRouter model catalog

**Files:**
- Modify: `nexoclip-app/packages/studio/src/models.js`
- Test: `nexoclip-app/packages/studio/src/models.test.js` (create if absent; otherwise extend the existing model tests)

**Interfaces:**
- Produces `OPENROUTER_IMAGE_MODEL_MAP`, `openRouterT2IModels`, and `openRouterI2IModels`.
- `openRouterT2IModels` and `openRouterI2IModels` contain original model objects and exclude unmapped models.
- The mapping values are OpenRouter image model slugs.

- [ ] **Step 1: Inspect the current test runner and model test conventions**

Run:

```bash
cd nexoclip-app/packages/studio && rtk npm test -- --run
```

Use the existing test file style if present; otherwise create a Node/Vitest-compatible test file matching `package.json`.

- [ ] **Step 2: Write failing catalog tests**

Add tests that assert:

```js
assert.equal(OPENROUTER_IMAGE_MODEL_MAP['nano-banana'], 'google/gemini-2.5-flash-image');
assert.equal(OPENROUTER_IMAGE_MODEL_MAP['nano-banana-pro'], 'google/gemini-3-pro-image');
assert.equal(OPENROUTER_IMAGE_MODEL_MAP['gpt-image-2'], 'openai/gpt-image-2');
assert.ok(openRouterT2IModels.some((model) => model.id === 'nano-banana'));
assert.ok(!openRouterT2IModels.some((model) => model.id === 'flux-dev'));
assert.ok(openRouterI2IModels.some((model) => model.id === 'nano-banana-edit'));
assert.ok(!openRouterI2IModels.some((model) => model.id === 'ai-image-upscaler'));
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
cd nexoclip-app/packages/studio && rtk npm test -- --run models.test.js
```

Expected: failure because the OpenRouter mapping and filtered catalogs do not exist yet.

- [ ] **Step 4: Implement the minimal mapping and filtered catalogs**

Add a centralized explicit mapping for only models confirmed in OpenRouter's general Models API filtered with `output_modalities=image` (`GET https://openrouter.ai/api/v1/models?output_modalities=image`). Treat returned model `id` values as the authoritative allowlist and use `architecture.input_modalities` plus `architecture.output_modalities` to validate I2I eligibility. Include mappings only where the target slug is present in that catalog; include Nano Banana variants, GPT Image 2, Flux 2 Pro/Flex/Max, Seedream 4.5/5.0, Qwen Image 3, Grok Imagine Image 2.0, and Recraft V4/V4.1 only where the frontend IDs have exact semantic matches. Omit MuAPI-only tools. Derive filtered arrays with `filter()` from `t2iModels` and `i2iModels`.

For I2I entries, map the frontend edit model to the corresponding OpenRouter image model that accepts image input; do not invent separate `-edit` OpenRouter slugs.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
cd nexoclip-app/packages/studio && rtk npm test -- --run models.test.js
```

Expected: all catalog tests pass.

---

### Task 2: Add failing tests for the server-side OpenRouter image adapter

**Files:**
- Create: `nexoclip-app/src/providers/openrouter/imageAdapter.js`
- Test: `nexoclip-app/tests/providers/openrouterImageAdapter.test.mjs`

**Interfaces:**
- Produces `createOpenRouterImageAdapter({ apiKey, baseUrl, fetch })`.
- `adapter.generate({ model, prompt, aspectRatio, resolution, quality, seed, referenceImages })` returns `{ provider: 'openrouter', status: 'succeeded', outputs: [{ url, mimeType }], usage, providerRequestId }`.
- The adapter sends `Authorization: Bearer <key>` and never includes the key in thrown errors.

- [ ] **Step 1: Write failing adapter tests**

Cover these behaviors:

```js
const adapter = createOpenRouterImageAdapter({
  apiKey: 'server-secret',
  baseUrl: 'https://openrouter.test',
  fetch: async (url, options) => response({
    created: 1,
    data: [{ b64_json: 'aGVsbG8=', media_type: 'image/png' }],
    usage: { cost: 0.04, total_tokens: 10 },
  }),
});

const result = await adapter.generate({
  model: 'google/gemini-2.5-flash-image',
  prompt: 'a red panda',
  aspectRatio: '1:1',
});

assert.equal(result.provider, 'openrouter');
assert.equal(result.status, 'succeeded');
assert.equal(result.outputs[0].url, 'data:image/png;base64,aGVsbG8=');
```

Also assert the request URL is `/api/v1/images`, the bearer header is present, the body contains `model`, `prompt`, and mapped options, and `referenceImages` becomes OpenRouter `input_references`.

Add an HTTP 401 test asserting a stable sanitized error code/message with no API key or upstream response body.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cd nexoclip-app && node --test tests/providers/openrouterImageAdapter.test.mjs
```

Expected: failure because the adapter module does not exist.

- [ ] **Step 3: Implement the minimal adapter**

Implement:

```js
export function createOpenRouterImageAdapter({
  apiKey,
  baseUrl = 'https://openrouter.ai',
  fetch: fetchImpl = globalThis.fetch,
} = {})
```

POST to `${baseUrl}/api/v1/images` with:

```js
{
  model,
  prompt,
  ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
  ...(resolution ? { resolution } : {}),
  ...(quality ? { quality } : {}),
  ...(seed !== undefined ? { seed } : {}),
  ...(referenceImages?.length ? {
    input_references: referenceImages.map((url) => ({
      type: 'image_url',
      image_url: { url },
    })),
  } : {}),
}
```

Normalize each `data[]` item using `media_type` defaulting to `image/png`. Use a generated request ID from the upstream `id` or `created` value when available, otherwise `null`; this is only metadata because the buffered Image API does not require polling. Preserve sanitized usage only.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
cd nexoclip-app && node --test tests/providers/openrouterImageAdapter.test.mjs
```

Expected: all adapter tests pass.

---

### Task 3: Add the server route and route tests

**Files:**
- Create: `nexoclip-app/app/api/openrouter/images/route.js`
- Test: `nexoclip-app/tests/api/openrouterImagesRoute.test.mjs`
- Modify: `nexoclip-app/.env.example`

**Interfaces:**
- `POST /api/openrouter/images` accepts `{ model, prompt, aspect_ratio, resolution, quality, seed, input_references }`.
- The route reads `OPENROUTER_API_KEY` only from server environment.
- The route returns the normalized adapter result or a sanitized error response.

- [ ] **Step 1: Write failing route tests**

Test missing server key returns 500/503 without contacting upstream; test a valid request forwards the body to the injected adapter boundary or mocked OpenRouter fetch and returns a normalized image result; test malformed input returns 400.

- [ ] **Step 2: Run focused route tests and verify RED**

Run:

```bash
cd nexoclip-app && node --test tests/api/openrouterImagesRoute.test.mjs
```

Expected: failure because the route does not exist.

- [ ] **Step 3: Implement the route**

Keep the route small: parse JSON, require a non-empty `model` and `prompt`, require `OPENROUTER_API_KEY`, construct the adapter with the environment key, translate `input_references` into reference URL strings, call `generate`, and return JSON. Never log request headers, API keys, or full upstream payloads.

Add to `.env.example`:

```text
OPENROUTER_API_KEY=
OPENROUTER_IMAGE_MODEL=google/gemini-2.5-flash-image
```

The environment model is documentation only; the frontend static mapping remains authoritative for model selection. The OpenRouter Models API is used during development/verification to confirm each mapping target exists and supports image output; runtime model discovery is not required.

- [ ] **Step 4: Run focused route tests and verify GREEN**

Run:

```bash
cd nexoclip-app && node --test tests/api/openrouterImagesRoute.test.mjs
```

Expected: all route tests pass.

---

### Task 4: Switch Image Studio client calls to OpenRouter-only

**Files:**
- Modify: `nexoclip-app/packages/studio/src/muapi.js`
- Modify: `nexoclip-app/packages/studio/src/components/ImageStudio.jsx`
- Modify: `nexoclip-app/packages/studio/src/components/CinemaStudio.jsx`
- Modify: `nexoclip-app/packages/studio/src/components/AiInfluencerStudio.jsx`
- Modify: `nexoclip-app/packages/studio/src/components/DrawModal.jsx`
- Modify: `nexoclip-app/components/StandaloneShell.js`
- Test: `nexoclip-app/packages/studio/src/openrouterImageClient.test.js`

**Interfaces:**
- Image Studio image calls use the new internal OpenRouter route, not MuAPI.
- `generateImage(apiKey, params)` and `generateI2I(apiKey, params)` retain their existing call signatures so the existing studio components require minimal changes; the `apiKey` argument is ignored for OpenRouter and must not be sent upstream.
- `apiKey` is no longer required for these browser calls; `StandaloneShell` must stop passing a hard-coded `null` as the only credential path.

- [ ] **Step 1: Write failing client tests**

Assert that `generateImage` calls `/api/openrouter/images` with the frontend model mapped to its OpenRouter slug, sends prompt/options, and does not send `x-api-key` or MuAPI URLs. Assert that `generateI2I` sends `input_references` and normalizes the response for Image Studio.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cd nexoclip-app/packages/studio && rtk npm test -- --run openrouterImageClient.test.js
```

Expected: failure because the existing functions still call MuAPI.

- [ ] **Step 3: Implement the OpenRouter-only client path**

Change only the image-generation exports in `packages/studio/src/muapi.js` or extract them into a dedicated `openrouter.js` and re-export them. The client must POST to the same-origin Next.js route with JSON and no provider secret. Use the mapping from Task 1; throw a clear client error if a selected frontend model has no mapping, though filtered catalogs should prevent that state.

Use `openRouterT2IModels` and `openRouterI2IModels` in Image Studio for selectors and defaults. Preserve existing parameter controls where OpenRouter supports them; omit MuAPI-only fields instead of forwarding unsupported payload keys.

Change the default selected model references from `t2iModels[0]`/`i2iModels[0]` to the filtered arrays. Ensure the arrays cannot be empty; Nano Banana is the required default.

For the related image-generation consumers (`CinemaStudio`, `AiInfluencerStudio`, and `DrawModal`), route their calls through the same OpenRouter image functions. Do not alter their non-image features.

Fix `StandaloneShell.js`'s `const apiKey = null` only as needed to remove the obsolete MuAPI image-key dependency; do not introduce a browser-exposed OpenRouter key.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
cd nexoclip-app/packages/studio && rtk npm test -- --run openrouterImageClient.test.js
```

Expected: all client tests pass.

---

### Task 5: Remove Image Studio MuAPI image paths and validate the migration

**Files:**
- Modify: `nexoclip-app/packages/studio/src/components/ImageStudio.jsx`
- Modify: `nexoclip-app/packages/studio/src/muapi.js` or `nexoclip-app/packages/studio/src/openrouter.js`
- Modify: `nexoclip-app/components/StandaloneShell.js`
- Test: existing Image Studio tests and provider tests

- [ ] **Step 1: Search for forbidden Image Studio MuAPI generation paths**

Run:

```bash
cd nexoclip-app && rtk proxy rg -n 'api\.muapi\.ai|/api/v1/|x-api-key|muapi_key|generateImage|generateI2I' packages/studio/src/components/ImageStudio.jsx packages/studio/src/components/CinemaStudio.jsx packages/studio/src/components/AiInfluencerStudio.jsx packages/studio/src/components/DrawModal.jsx packages/studio/src/muapi.js components/StandaloneShell.js
```

Expected: image generation calls use `/api/openrouter/images`; remaining MuAPI references must be limited to unrelated non-image functions or legacy code explicitly outside Image Studio.

- [ ] **Step 2: Run all ViMax web tests**

Run:

```bash
cd nexoclip-app/services/vimax/web && rtk npm test -- --run
```

Expected: 7 test files and 36 tests pass.

- [ ] **Step 3: Run all repository Node tests directly**

Run:

```bash
cd nexoclip-app && node --test tests/**/*.test.mjs
```

Expected: all existing and new tests pass; if shell glob expansion is insufficient, run the explicit test directories with `find tests -name '*.test.mjs' -print0 | xargs -0 node --test`.

- [ ] **Step 4: Build the production app**

Run:

```bash
cd nexoclip-app && rtk npm run build
```

Expected: Next.js production build exits 0.

- [ ] **Step 5: Run formatting/diff checks**

Run:

```bash
cd nexoclip-app && rtk git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 6: Review the final diff for scope and secrets**

Run:

```bash
rtk git diff --stat
rtk proxy rg -n 'OPENROUTER_API_KEY|Authorization.*Bearer|x-api-key' nexoclip-app/app nexoclip-app/src nexoclip-app/packages/studio/src --glob '!*.test.*'
```

Confirm the OpenRouter secret appears only in server route/environment access, never in browser bundles or static client code. Do not commit or push until this review is complete and the user approves the resulting diff.
