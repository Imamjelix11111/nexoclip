# OpenRouter Video Model Mapping Expansion

Date: 2026-08-27
Related: `docs/superpowers/specs/2026-08-27-video-studio-openrouter-filter-design.md`,
`docs/2026-08-24-muapi-dependency-audit.md`

## Why

Filtering Video Studio's V2V picker to OpenRouter-mapped models only
(`docs/superpowers/specs/2026-08-27-video-studio-openrouter-filter-design.md`)
made the size of `OPENROUTER_V2V_MODEL_MAP`/`OPENROUTER_VIDEO_MODEL_MAP`
directly visible to users for the first time. This document records the
research done to expand those maps against OpenRouter's current
video-output catalog, and — per the same standard set by the
`seedance-2-watermark-remover` exclusion in the dependency audit — why
several name-matching candidates were deliberately left unmapped.

## Method

For each model in OpenRouter's video-output catalog (24 models, supplied
2026-08-27; the catalog listing page itself is client-rendered and not
reliably scrapable — an earlier attempt produced fabricated model names,
so this list came from the user directly, not automated fetching), the
model's individual OpenRouter documentation page
(`openrouter.ai/<publisher>/<model>`) was checked for two things:

1. A MuAPI-side counterpart id in `t2vModels`/`i2vModels`/`v2vModels`
   (`packages/studio/src/models.js`), matched by publisher + model family
   name.
2. Documented input modalities — specifically whether the model accepts
   video as an input (required for `OPENROUTER_V2V_MODEL_MAP`) versus
   text/image only (`OPENROUTER_VIDEO_MODEL_MAP`).

This is **documentation-based verification, not live API testing** — a
weaker standard than the "confirmed live" bar used for the three existing
V2V entries. Accepted tradeoff (user decision): faster/cheaper than
per-model live API calls; risk is a mapping that reads correctly in docs
but behaves unexpectedly at runtime, which would surface as a normal
`OpenRouter video request failed` error, not a silent wrong-output bug —
if that happens, the fix is removing the entry, same as any other bug.

## Mapped (added to OPENROUTER_VIDEO_MODEL_MAP)

31 new MuAPI ids across 9 OpenRouter models — see the table in
`docs/superpowers/plans/2026-08-27-video-studio-openrouter-filter.md`
(Task 3) for the full id-by-id mapping. Summary by OpenRouter model:

- `kwaivgi/kling-video-o1` — Kling O1's T2V/I2V/reference-to-video MuAPI
  ids. Doc: "supports text and image inputs with video output,
  enabling text-to-video and image-to-video workflows" — no video input.
- `x-ai/grok-imagine-video` / `x-ai/grok-imagine-video-1.5` — Grok
  Imagine's T2V/I2V ids. Doc: "accepts text and images as input" for
  both versions; the 1.5 preview MuAPI id (`grok-imagine-video-1-5-preview`)
  matches the versioned OpenRouter slug specifically rather than the base
  model.
- `alibaba/happyhorse-1.0` / `alibaba/happyhorse-1.1` — HappyHorse's T2V/
  I2V/reference-to-video MuAPI ids (both version tracks, 1080p/720p
  variants). Doc for both versions: "accepts text and images as input",
  generates "from a text prompt, a single starting image, or a set of
  reference images" — no video input for either version.
- `alibaba/wan-2.6` — base T2V/I2V ids only (`wan2.6-text-to-video`,
  `wan2.6-image-to-video`). Doc mentions "reference videos" as a
  generation source but doesn't clarify whether that's a true video input
  vs. a contextual parameter — treated as insufficient evidence for
  `OPENROUTER_V2V_MODEL_MAP`, so no V2V mapping added for this model.
- `bytedance/seedance-2.5` — T2V/I2V/first-last-frame/omni-reference ids.
  Doc confirms text, image, video, **and audio** input, explicitly
  mentions "video editing, and video extension" and "up to 50 image,
  video, and audio reference assets" — the strongest V2V signal found in
  this pass. However, no MuAPI id in `v2vModels` corresponds specifically
  to a Seedance 2.5 video-extend/edit tool (only Seedance 1.5 Pro has
  that), so this capability is captured through `seedance-2.5-omni-reference`
  (I2V + multi-reference) instead — not through `OPENROUTER_V2V_MODEL_MAP`.
  `-spicy` variants (`seedance-2.5-spicy-text-to-video`,
  `seedance-2.5-spicy-image-to-video`) were deliberately excluded — likely
  an NSFW/relaxed-content-policy mode, and OpenRouter's content policy for
  that mode wasn't confirmed, so routing it through OpenRouter risked a
  behavior change beyond just backend.
- `bytedance/seedance-2.0-fast` — base T2V/I2V ids only
  (`seedance-2-text-to-video-fast`, `seedance-2-image-to-video-fast`).
  MuAPI also has `seedance-2-vip-*-fast` and
  `seedance-2-omni-reference-no-video-fast` variants in this family;
  these were left unmapped this pass (VIP tier already serves Marketing
  Studio via a separate direct MuAPI call, and "no-video" in the id name
  suggests different capability than the base model docs describe) —
  worth a follow-up pass, not a confirmed exclusion.

## Explicitly excluded from OPENROUTER_V2V_MODEL_MAP

Every MuAPI V2V-shaped id that name-matched a new OpenRouter candidate was
checked and excluded because the model's docs describe text/image input
only:

- `kling-o1-video-edit`, `kling-o1-video-edit-fast`,
  `kling-o1-standard-video-edit` (would-be `kwaivgi/kling-video-o1`) —
  doc: "no mention of video input capability or video editing features".
- `happy-horse-1-video-edit-1080p`, `happy-horse-1-video-edit-720p`,
  `happy-horse-1.1-video-edit-1080p`, `happy-horse-1.1-video-edit-720p`
  (would-be `alibaba/happyhorse-1.0`/`1.1`) — same as the T2V/I2V doc
  finding above, no video input for either version.

`OPENROUTER_V2V_MODEL_MAP` is unchanged this pass — still exactly
`runway-aleph-v2v`, `wan2.7-video-extend`, `wan2.7-video-edit`.

## No MuAPI counterpart (nothing to map)

These OpenRouter catalog models have no matching id anywhere in
`t2vModels`/`i2vModels`/`v2vModels` today, so there's nothing to point a
map entry at:

- `alibaba/wan-3.0`
- `heygen/avatar-iv`
- `black-forest-labs/flux-video-upscale`
- `black-forest-labs/flux-3-video`
- `minimax/hailuo-3`

## Skipped pending a version-confirmed MuAPI id

- `runway/gen-4.5` — MuAPI has `runway-text-to-video`/
  `runway-image-to-video`, but nothing in either id confirms which Runway
  generation they run (Gen-3? Gen-4? Gen-4.5?). Doc confirms Gen-4.5 is
  text/image input only (no V2V), but mapping the unversioned MuAPI ids to
  a specific version risks silently changing which model version a user's
  job actually runs on. Left unmapped until a version-specific MuAPI id
  exists or this can be confirmed live.

## Open follow-ups

1. `seedance-2-vip-*-fast` and `seedance-2-omni-reference-no-video-fast`
   (part of the Seedance 2.0 Fast family) — not researched this pass, see
   note above.
2. Confirm live (not just doc-based) whether `alibaba/wan-2.6`'s
   "reference videos" generation source is a real video-input path before
   promoting it to `OPENROUTER_V2V_MODEL_MAP`.
3. `runway-text-to-video`/`runway-image-to-video` version confirmation
   (see above).
