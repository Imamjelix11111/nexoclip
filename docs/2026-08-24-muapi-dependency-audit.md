# MuAPI Dependency Audit — Which Features Have No Fallback

Date: 2026-08-24
Related: `docs/2026-08-24-provider-fallback-notes.md` (OpenRouter → direct provider fallback)

## Update (same day, after the audit)

Two rows moved from "pure MuAPI" to "hybrid" after this doc was written —
tracked here rather than silently editing the original audit result below.

- **Video Studio V2V**: 3 of the ~35 V2V models now route through OpenRouter
  first — `runway-aleph-v2v` (→ `runway/aleph-2`), `wan2.7-video-extend` and
  `wan2.7-video-edit` (→ `alibaba/wan-2.7`). These were the only V2V models
  where OpenRouter's video-input contract could be confirmed live (SKU/
  passthrough-param evidence, not just name-matching). The other ~32 V2V
  models (Kling motion-control, Luma, MMAudio, watermark/upscale/face-swap
  tools, etc.) are still pure MuAPI, no fallback — see the caveat that killed
  `seedance-2-watermark-remover` below.
- **Video Studio I2V**: `seedance-2-mini-image-to-video` ("Seedance 2 Mini")
  added to `OPENROUTER_VIDEO_MODEL_MAP` → `bytedance/seedance-2.0-mini`, with
  BytePlus direct fallback to `dreamina-seedance-2-0-mini-260615`. This also
  surfaced and fixed a real bug: `generateVideoOpenRouter` was tagging every
  image past the first as `frame_type: 'last_frame'` (i.e. "the video must
  end looking like this"), which is wrong for reference-style multi-image
  models — multi-reference models now send `input_references` instead.
- "Seedance 2 Omni Reference" (`seedance-2-omni-reference`, 9-image
  reference model) itself was **not** added — no equivalent standalone model
  ID exists on OpenRouter's video catalog; the reference capability lives on
  the base `bytedance/seedance-2.0`/`-mini` model IDs already mapped above.

**Caveat worth remembering:** `seedance-2-watermark-remover` and its "pro"
variant were deliberately *not* mapped despite matching by name — MuAPI's
description reveals it actually runs on LaMa AI inpainting, not the Seedance
generative model, so rerouting it through `bytedance/seedance-2.0` + a text
instruction would change the actual algorithm and likely the output quality,
not just the backend. Name-matching against MuAPI's model list is not
sufficient evidence on its own; each mapping in this doc was confirmed live
against the actual OpenRouter/BytePlus schema before being added.

## Why this exists

While debugging the OpenRouter → BytePlus fallback, we asked "does Vibe
Motion have the same fallback?" — answer: no, because Vibe Motion doesn't go
through `providerRouter.js` at all, it calls MuAPI directly. That prompted a
full audit of `packages/studio/src/muapi.js` to find every other feature in
the same boat: **if MuAPI goes down or rate-limits, these features have no
fallback and just fail.**

## Audit method

Grepped every `export async function` in `packages/studio/src/muapi.js`,
then grepped every studio component under `packages/studio/src/components/`
for which of those functions it imports, to classify each studio by backend
path.

## Result

### Pure MuAPI — no fallback exists (submitAndPoll → `api.muapi.ai`, same
pattern as Vibe Motion)

| Studio | muapi.js function(s) | Endpoint |
|---|---|---|
| Vibe Motion Studio | `runMotionGraphics`, `runMotionGraphicsEdit` | `motion-graphics`, `motion-graphics-edit` |
| Lip Sync Studio | `processLipSync` | model-dependent (`getLipSyncModelById(...).endpoint`) |
| Audio Studio | `generateAudio` | model-dependent (`getAudioModelById(...).endpoint`) |
| Recast Studio | `processRecast` | model-dependent (`getRecastModelById(...).endpoint`) |
| Marketing Studio | `generateMarketingStudioAd` | `seedance-2-vip-omni-reference` / `sd-2-vip-omni-reference-1080p` |
| Video Studio (V2V sub-feature, ~32 of 35 models) | `processV2V` | model-dependent (`getV2VModelById(...).endpoint`) — see Update above for the 3 exceptions |
| Workflow Studio | `executeWorkflow`, `runSingleNode`, node schema calls | full node-based workflow engine |

Also flagged but unresolved: `muapi.js` exports a full Agent-chat API surface
(`getTemplateAgents`, `getUserAgents`, `sendAgentChatMessage`,
`pollAgentChatResult`, `createAgent`, `getAgentConversation`, ...), but no
`.jsx` component in the current repo imports any of it — only a stale
reference survives in `packages/studio/dist/components/AgentStudio.js`
(a build artifact). `src/components/AgentStudio.js` (the one actually wired
into `StandaloneShell.js`) is just a "web only" placeholder with no MuAPI
calls. **Unresolved: confirm whether Agent chat is a live feature elsewhere
in the app, or dead code left over from a previous version, before spending
effort on it.**

### Hybrid — OpenRouter first if the model is mapped, MuAPI otherwise

| Studio | Functions | Notes |
|---|---|---|
| Video Studio (T2V / I2V generation) | `generateVideo`, `generateI2V` | Checks `OPENROUTER_VIDEO_MODEL_MAP[params.model]` first; falls back to MuAPI `submitAndPoll` only for models not in that map. Not the same as our `providerRouter.js` OpenRouter→direct fallback — this is a static model-to-backend routing table, decided client-side, not a retry-on-failure path. Now includes `seedance-2-mini-image-to-video`. |
| Video Studio (V2V, 3 of 35 models) | `processV2V` | `runway-aleph-v2v`, `wan2.7-video-extend`, `wan2.7-video-edit` only — via `OPENROUTER_V2V_MODEL_MAP`, no MuAPI fallback for the OpenRouter leg on these three. Falls back to `providerRouter.js` (BytePlus/etc) same as image/video generation for the ones with a direct-provider mapping. |

### OpenRouter-only (covered by today's fallback work)

| Studio | Functions |
|---|---|
| Image Studio, Draw Modal (I2I), Cinema Studio, AI Influencer Studio | `generateImage`, `generateI2I` → `/api/openrouter/images` |

### Not MuAPI at all (self-hosted)

| Studio | Path |
|---|---|
| AI Clipping | `runClipping` → `/api/ai-clip/jobs` (own service, no MuAPI involvement) |

## Open questions / next steps (not yet decided or built)

1. **Scope decision needed:** does "provider fallback" extend to the 7
   pure-MuAPI studios, or does MuAPI itself already have upstream redundancy
   we don't need to replicate? Nothing has been designed or built for this —
   this document is the audit only.
2. If fallback is wanted for those studios, each one needs its own direct
   provider identified per model (MuAPI wraps many underlying vendors per
   endpoint — e.g. `getLipSyncModelById`, `getAudioModelById`,
   `getRecastModelById`, `getV2VModelById` each resolve to a different
   vendor per model choice), so this is not a single drop-in fix like the
   BytePlus/OpenAI one — it's N separate integrations.
3. Confirm the Agent-chat dead-code question above before scoping any work
   there.

## Files referenced

- `nexoclip-app/packages/studio/src/muapi.js`
- `nexoclip-app/packages/studio/src/components/*.jsx`
- `nexoclip-app/src/components/AgentStudio.js`
- `nexoclip-app/packages/studio/dist/components/AgentStudio.js` (build artifact, stale reference only)
