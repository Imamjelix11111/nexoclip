# Video Studio: OpenRouter-only V2V picker + mapping expansion

Date: 2026-08-27
Related: `docs/2026-08-24-muapi-dependency-audit.md`, `docs/2026-08-24-provider-fallback-notes.md`

## Why

Video Studio's model picker should only offer models that route through
OpenRouter (i.e. have a direct-provider/OpenRouter fallback), not the
pure-MuAPI models that have no fallback if MuAPI goes down. Investigating
this surfaced two things:

1. T2V and I2V pickers are **already** filtered this way — `models.js`
   already exports `openRouterT2VModels`/`openRouterI2VModels`
   (`t2vModels`/`i2vModels` filtered through `OPENROUTER_VIDEO_MODEL_MAP`),
   and `VideoStudio.jsx` already builds its dropdown from those, not the
   raw lists.
2. **V2V is not filtered** — the dropdown still builds from the raw
   `v2vModels` (35 models), even though only 3 are in
   `OPENROUTER_V2V_MODEL_MAP` today.
3. The user supplied the current OpenRouter video-output catalog (24
   models), most of which aren't yet in either map. Since the picker filter
   makes the *size* of the map directly visible to users, this is a good
   moment to also expand the maps — otherwise "OpenRouter-only" mode makes
   Video Studio look far more limited than it needs to be.

This spec covers two independent pieces of work:

- **A. Picker filter** — mechanical, mirrors the existing T2V/I2V pattern.
- **B. Mapping expansion** — research task, adds new entries to
  `OPENROUTER_VIDEO_MODEL_MAP` and `OPENROUTER_V2V_MODEL_MAP` based on
  public OpenRouter documentation (not live API verification — see
  Verification method below).

## A. Picker filter (V2V)

**`packages/studio/src/models.js`**: add, next to `openRouterT2VModels`/
`openRouterI2VModels` (~line 19479):

```js
export const openRouterV2VModels = v2vModels.filter((model) => OPENROUTER_V2V_MODEL_MAP[model.id]);
```

**`packages/studio/src/components/VideoStudio.jsx`**: replace `v2vModels`
with `openRouterV2VModels` everywhere it feeds the **picker/dropdown or a
"pick a default model" decision** — i.e. dropdown category entries
(~line 160, 176), and default-model fallbacks (~line 884, 1042 —
`const firstV2V = v2vModels[0]` → `openRouterV2VModels[0]`).

**Do NOT change** raw `v2vModels` usages that resolve an *existing* model
id for display purposes — `getV2VModelById(...)`, `v2vModels.find(...)`
(~line 587, 1930). These must keep working against the full list so that
history entries referencing a now-hidden model (e.g. a job run before this
change, or run against a model that never made it into the OpenRouter map)
still render correctly. Only new-job model *selection* is restricted.

No changes to `muapi.js` — `processV2V` already checks
`OPENROUTER_V2V_MODEL_MAP` first and falls back to MuAPI; that logic is
unchanged, only the map's contents grow (see part B).

## B. Mapping expansion

**Candidate source**: the OpenRouter video-output catalog as of
2026-08-27 (user-supplied, not scraped — the OpenRouter models page is
client-rendered and an earlier WebFetch attempt against it produced
fabricated model names; do not trust automated fetches of that page):

```
alibaba/wan-3.0, heygen/avatar-iv, black-forest-labs/flux-video-upscale,
bytedance/seedance-2.0-mini, bytedance/seedance-2.5,
black-forest-labs/flux-3-video, minimax/hailuo-3, runway/aleph-2,
runway/gen-4.5, x-ai/grok-imagine-video-1.5, alibaba/happyhorse-1.1,
alibaba/happyhorse-1.0, x-ai/grok-imagine-video, google/veo-3.1-fast,
google/veo-3.1-lite, kwaivgi/kling-video-o1, minimax/hailuo-2.3,
alibaba/wan-2.7, bytedance/seedance-2.0-fast, bytedance/seedance-2.0,
alibaba/wan-2.6, bytedance/seedance-1-5-pro, openai/sora-2-pro,
google/veo-3.1
```

**Already mapped** (9 unique OpenRouter models, 18 T2V/I2V keys + 2 V2V
keys — see `OPENROUTER_VIDEO_MODEL_MAP`/`OPENROUTER_V2V_MODEL_MAP` in
`models.js`): `bytedance/seedance-2.0`, `bytedance/seedance-2.0-mini`,
`google/veo-3.1`, `google/veo-3.1-fast`, `google/veo-3.1-lite`,
`kwaivgi/kling-v3.0-pro`, `kwaivgi/kling-v3.0-std`, `minimax/hailuo-2.3`,
`openai/sora-2-pro`, `runway/aleph-2`, `alibaba/wan-2.7`.

**Remaining candidates to research**: `alibaba/wan-3.0`, `heygen/avatar-iv`,
`black-forest-labs/flux-video-upscale`, `bytedance/seedance-2.5`,
`black-forest-labs/flux-3-video`, `minimax/hailuo-3`, `runway/gen-4.5`,
`x-ai/grok-imagine-video-1.5`, `x-ai/grok-imagine-video`,
`alibaba/happyhorse-1.0`, `alibaba/happyhorse-1.1`,
`bytedance/seedance-2.0-fast`, `alibaba/wan-2.6`,
`bytedance/seedance-1-5-pro`, `kwaivgi/kling-video-o1`.

**Method**: for each candidate, find its MuAPI-side counterpart by
publisher+family name match against `t2vModels`/`i2vModels`/`v2vModels`
ids (e.g. `seedance-v1.5-pro-video-extend*` ↔ `bytedance/seedance-1-5-pro`,
`kling-o1-video-edit*` ↔ `kwaivgi/kling-video-o1`,
`happy-horse-1.1-video-edit-*` ↔ `alibaba/happyhorse-1.1`), then check
OpenRouter's public documentation for that model:

- **T2V/I2V**: confirm video-output modality and that it accepts
  image input (`frame_images`/`input_references` with `image_url`, per
  the existing `generateVideoOpenRouter` contract). Add to
  `OPENROUTER_VIDEO_MODEL_MAP`.
- **V2V**: confirm the documentation explicitly describes accepting video
  as input (not just name-similarity to a MuAPI tool). Add to
  `OPENROUTER_V2V_MODEL_MAP` only when that's explicit. This repeats the
  standard already set by the `seedance-2-watermark-remover` case (skipped
  because MuAPI's own docs revealed it runs on LaMa inpainting, not a
  generative video model, despite the name match) — every candidate gets
  this same scrutiny, not just the watermark tools.

**Verification method — explicitly doc-based, not live API calls**: this
is weaker evidence than the "confirmed live" standard used for the three
existing V2V entries (which were tested against real API responses). The
user chose doc-based verification for this expansion to avoid API cost/
time. Accepted risk: a mapping that looks right in docs could still fail
or behave unexpectedly at runtime; if that happens it surfaces as a normal
`OpenRouter video request failed` error (no special handling needed) and
should be corrected by removing the entry, same as any other bug fix.

**Output**: new dated doc,
`docs/2026-08-27-openrouter-video-model-expansion.md`, documenting the
final candidate → MuAPI-id mapping table with include/skip decisions and
the doc source/reasoning for each, following the style of
`docs/2026-08-24-muapi-dependency-audit.md`.

## Testing

Manual, in the running app (no automated test infra for this component
currently):

1. Open Video Studio, switch to V2V — dropdown shows only the mapped
   subset (3 today, more after part B), not all 35.
2. Run one generation end-to-end for a newly-mapped V2V model, confirm it
   completes via the OpenRouter path (not MuAPI).
3. Load a workspace with V2V job history referencing a model that is *not*
   in the map (hidden from the picker) — confirm the history entry still
   renders (thumbnail, model name) via the unfiltered lookup path.
4. Confirm T2V/I2V pickers are unaffected (already filtered, not touched
   by this change).

## Out of scope

- Live API verification of new mappings (doc-based only, see above).
- Expanding fallback coverage for the other pure-MuAPI studios (Vibe
  Motion, Lip Sync, Audio, Recast, Marketing, Workflow) — tracked as open
  questions in `docs/2026-08-24-muapi-dependency-audit.md`, not this spec.
- A UI toggle to show/hide non-OpenRouter models — filter is permanent per
  user decision.
