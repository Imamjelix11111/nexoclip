# Seedream 4.5 BytePlus Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fall back from OpenRouter to BytePlus when `bytedance-seed/seedream-4.5` generation fails.

**Architecture:** Reuse the existing explicit direct-provider registry and one-attempt fallback router. Add only the missing alias mapping to BytePlus model `seedream-4-5-251128`.

**Tech Stack:** Node.js ES modules, built-in `node:test`, existing provider router.

## Global Constraints

- OpenRouter remains the primary provider.
- BytePlus fallback requires `BYTEPLUS_API_KEY` and `BYTEPLUS_BASE_URL`.
- Unmapped models remain OpenRouter-only.
- No new dependency or provider abstraction.

---

### Task 1: Register and verify Seedream 4.5 fallback

**Files:**
- Modify: `tests/providers/byteplusModelRegistry.test.mjs`
- Modify: `tests/providers/byteplusImageFallback.test.mjs`
- Modify: `src/providers/providerRegistry.js`

**Interfaces:**
- Consumes: `getDirectProvider(model)` and `createProviderRouter(...).generateImage(params)`.
- Produces: mapping `{ provider: 'byteplus', model: 'seedream-4-5-251128' }` for `bytedance-seed/seedream-4.5`.

- [ ] **Step 1: Write failing tests**

Add a registry assertion and an integration case where OpenRouter returns the reported generic 400 error and BytePlus succeeds.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/providers/byteplusModelRegistry.test.mjs tests/providers/byteplusImageFallback.test.mjs`

Expected: FAIL because `bytedance-seed/seedream-4.5` has no direct-provider mapping.

- [ ] **Step 3: Implement minimal mapping**

Add:

```js
['bytedance-seed/seedream-4.5', { provider: 'byteplus', model: 'seedream-4-5-251128' }],
```

- [ ] **Step 4: Verify GREEN**

Run the focused tests, then all provider tests:

```bash
node --test tests/providers/byteplusModelRegistry.test.mjs tests/providers/byteplusImageFallback.test.mjs
node --test tests/providers/*.test.mjs
```

Expected: PASS.
