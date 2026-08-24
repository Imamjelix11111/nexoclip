# Provider Fallback (OpenRouter → Direct) — Session Notes

Date: 2026-08-24

## Goal

Backend AI routes should try OpenRouter first, then fall back to the model's
owning provider directly (BytePlus ModelArk / Google / OpenAI) on transient
OpenRouter failures — without ever swapping the requested model.

Design doc: `docs/superpowers/plans/2026-04-03-provider-fallback.md`
Code: `nexoclip-app/src/providers/` (`providerRegistry.js`, `providerRouter.js`,
`direct/*`, `openrouter/*`)

## Bugs found and fixed, in the order they surfaced

Trigger case throughout: `bytedance-seed/seedream-5-0-pro` (OpenRouter alias)
→ should fall back to BytePlus `dola-seedream-5-0-pro-260628`.

### 1. Fallback never triggered at all
`isRetryableProviderError` only treated 408/409/429/5xx as retryable. A 4xx
from OpenRouter was thrown straight to the client, no fallback attempt.

**Fix:** in `providerRouter.js`, once a model has an explicit entry in the
direct-provider allowlist (`getDirectProvider(model)` returns non-null), a
400 or 402 from OpenRouter is also treated as a routing/capacity gap and
triggers fallback. Unmapped models are untouched — still hard-fail on
4xx exactly as before. Pattern-matching OpenRouter's error *text* was tried
first and abandoned — the wording isn't a stable contract, so the check is
keyed off the model mapping instead, not the message.

### 2. Misdiagnosed root cause: 402, not 400
Live curl to OpenRouter with the project's real key showed the actual failure
was `402 Insufficient credits`, not a "model not found" 400 — both collapse
to the same generic `OPENROUTER_REQUEST_FAILED` code client-side, which is
what made them look identical from the error JSON alone. 402 is included in
the same fallback rule as #1 (user confirmed: OpenRouter billing gaps should
not block a model that has a direct provider).

**Action item (not code):** OpenRouter account still needs credits topped up —
fallback keeps Seedream alive, but every OpenRouter-only model with no direct
mapping keeps failing until the balance is refilled.

### 3. BytePlus adapter sent an invalid request
Once fallback reached BytePlus, it failed with `BYTEPLUS_IMAGE_FAILED`.
Root cause: the adapter mapped `aspectRatio` (e.g. `"1:1"`) straight into
BytePlus's `size` param. BytePlus only accepts `WIDTHxHEIGHT` or a preset
(`1K`/`2K`/`4K`) for `size` — an aspect ratio there is `InvalidParameter`.

**Fix:** `direct/imageAdapters.js` — dropped the `aspectRatio → size`
mapping, kept `resolution → size` only, added `response_format: 'url'`, and
surface the real provider error detail (sanitized) instead of a generic
message, so this class of bug is visible next time.

### 4. Persistence assumed base64-only output
BytePlus returns a **hosted https URL** (pre-signed TOS link), not a
`data:image/...;base64,...` URL like Google/OpenAI/OpenRouter. The persist
step's regex only matched data URLs, so it threw `INVALID_IMAGE_OUTPUT`.

**Fix:** `services/generatedImageService.js` now also accepts `http(s)://`
outputs — downloads the bytes, validates `content-type` against an allowlist
(`image/png|jpeg|webp`), then stores in R2 as before.

## GPT/OpenAI image fallback (added same session)

The registry only had a bare `gpt-image-` prefix rule, which never matches
OpenRouter's actual namespaced IDs. Checked OpenRouter's live model list —
the only OpenAI models with image *output* are:

```
openai/gpt-5-image        → gpt-image-1     (OpenAI direct)
openai/gpt-5-image-mini   → gpt-image-1-mini
openai/gpt-5.4-image-2    → gpt-image-2
```

Confirmed these direct model names exist via `api.openai.com/v1/models`.
Added explicit mappings in `providerRegistry.js` and generalized the
namespace-stripping logic (previously only stripped `google/`) to also
handle `openai/gpt-image-*`. `createOpenAIImageAdapter` didn't have the
aspectRatio/size bug BytePlus had — it never forwards aspectRatio to `size`.

## Verification

- All fixes verified against the **real** OpenRouter / BytePlus / OpenAI
  APIs using the keys in `.env.local` (not just mocked unit tests) — this is
  how bugs #2 and #3 were actually found.
- 40 tests passing across `tests/providers/*`, `tests/services/generatedImageService.test.mjs`,
  `tests/api/imageJobMigration.test.mjs`, `tests/api/videoJobMigration.test.mjs`.
- New test files this session: `byteplusImageFallback.test.mjs`,
  `gptImageFallback.test.mjs`, `generatedImageService.test.mjs`.

## Out of scope / explicitly NOT covered

**Vibe Motion Studio** (`packages/studio/src/components/VibeMotionStudio.jsx`)
does not go through `providerRouter.js` at all. It calls MuAPI directly:
`POST https://api.muapi.ai/api/v1/motion-graphics` (proxied through `/api/*`
in the browser). Payload is just `prompt` / `aspect_ratio` / `duration_seconds`
— no selectable `model` param, so there's no OpenRouter↔direct fallback to
add here without a separate design (MuAPI has no documented direct-provider
equivalent wired into this app).

## Files touched

- `nexoclip-app/src/providers/providerRegistry.js`
- `nexoclip-app/src/providers/providerRouter.js`
- `nexoclip-app/src/providers/openrouter/imageAdapter.js`
- `nexoclip-app/src/providers/openrouter/videoAdapter.js`
- `nexoclip-app/src/providers/direct/imageAdapters.js`
- `nexoclip-app/src/services/generatedImageService.js`
- `nexoclip-app/tests/providers/byteplusImageFallback.test.mjs` (new)
- `nexoclip-app/tests/providers/gptImageFallback.test.mjs` (new)
- `nexoclip-app/tests/services/generatedImageService.test.mjs` (new)

Nothing has been committed yet — all changes are in the working tree.
