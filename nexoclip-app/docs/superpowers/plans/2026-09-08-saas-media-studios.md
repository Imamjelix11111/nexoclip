# SaaS Media Studios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Cinema, AI Influencer, and Video Studio into the credited durable SaaS generation pipeline.

**Architecture:** Cinema and AI Influencer are durable image jobs using `generateSaasImage`. Video jobs use the existing generation queue with a new handler that submits, polls, downloads, and persists a tenant-scoped video asset through the provider router.

**Tech Stack:** Next.js App Router, React, Node.js, PostgreSQL/pg, BullMQ, IORedis, OpenRouter/direct provider adapters, local/R2 object storage.

## Global Constraints
- Preserve compatibility routes, but no Studio request may use MuAPI, BYOK, or browser provider credentials.
- Use server-derived tenant authorization and `POST /api/generations`.
- Reserve credits before publication; settle only from workers.
- Store outputs as tenant-scoped assets and use authenticated asset download URLs.
- Explicitly reject unsupported video models or parameters; never silently downgrade.

---

### Task 1: Generalize the SaaS client submission contract

**Files:**
- Modify: `packages/studio/src/generationClient.js`
- Test: `tests/frontend/saasMediaClient.test.mjs`

**Interfaces:**
- Produces `generateSaasImage(params)` and `generateSaasVideo(params)`, each returning `{ id, provider, outputs: [{ url }] }` after polling `/api/generations/:id`.

- [ ] Write failing tests that assert image and video requests send a workspace header, canonical model, prompt, parameters, and no API key header.
- [ ] Run `node --test tests/frontend/saasMediaClient.test.mjs`; expect failure because `generateSaasVideo` is missing.
- [ ] Add a shared submit-and-poll helper used by image and video clients; make video submit `{ kind: 'video' }` and image submit `{ kind: 'image' }`.
- [ ] Re-run the test; expect pass.
- [ ] Commit `feat(studio): add durable SaaS media client`.

### Task 2: Migrate Cinema and AI Influencer image submissions

**Files:**
- Modify: `packages/studio/src/components/CinemaStudio.jsx`
- Modify: `packages/studio/src/components/AiInfluencerStudio.jsx`
- Test: `tests/frontend/cinemaSaasClient.test.mjs`
- Test: `tests/frontend/influencerSaasClient.test.mjs`

**Interfaces:**
- Consumes `generateSaasImage({ model, prompt, workspace_id, parameters, idempotencyKey })`.
- Cinema model is `bytedance-seed/seedream-4.5`.
- Influencer uses a canonical model mapped by `OPENROUTER_IMAGE_MODEL_MAP`.

- [ ] Write failing source-contract tests proving the two studios import/use `generateSaasImage` and do not call `generateImage(apiKey, ...)`.
- [ ] Run both tests; expect failure on legacy client use.
- [ ] Replace direct calls, derive `workspace_id` from session storage, pass aspect ratio/reference parameters, and use returned durable output URL in local history callbacks.
- [ ] Re-run tests; expect pass.
- [ ] Commit `feat(studio): migrate cinema and influencer to SaaS jobs`.

### Task 3: Add durable video provider handler

**Files:**
- Create: `src/services/saasVideoGeneration.js`
- Modify: `src/services/saasImageGeneration.js` (extract shared tenant asset-reference resolver if needed)
- Test: `tests/generations/saasVideoGeneration.test.mjs`

**Interfaces:**
- Produces `createDefaultSaasVideoHandler({ pool, storage, providerRouter })`.
- Handler accepts a claimed `generation_jobs` row and returns `{ status: 'succeeded', provider, providerRequestId, outputs: [{ assetId }], usage }`.

- [ ] Write failing tests for submit → completed poll → download → storage write → generated asset persistence, plus an asset reference from another workspace rejected before provider submit.
- [ ] Run `node --test tests/generations/saasVideoGeneration.test.mjs`; expect missing module failure.
- [ ] Implement parameter translation: duration, resolution, aspectRatio, seed, `referenceImages`, `frameImages`, and `referenceVideos`; poll until completed or provider terminal failure; store downloaded bytes with provider MIME type.
- [ ] Re-run tests; expect pass.
- [ ] Commit `feat(video): persist SaaS video provider outputs`.

### Task 4: Run a persistent video worker

**Files:**
- Create: `src/queue/videoWorker.mjs`
- Modify: `package.json`
- Modify: `docker-compose.prod.yml`
- Test: `tests/queue/videoWorker.test.mjs`

**Interfaces:**
- Produces `createVideoWorker(options)` and `videoWorkerConfig(env)`.
- Command: `npm run worker:video`.

- [ ] Write failing tests for `VIDEO_WORKER_CONCURRENCY` validation and worker composition using `createDefaultSaasVideoHandler` plus `persistGenerationResult`.
- [ ] Run `node --test tests/queue/videoWorker.test.mjs`; expect missing module failure.
- [ ] Implement the worker by mirroring `imageWorker.mjs`; use the same queue/recovery lifecycle and provider default `openrouter`.
- [ ] Add `worker:video` and production Compose service sharing database, Redis, and object storage with the image worker.
- [ ] Re-run tests; expect pass.
- [ ] Commit `feat(worker): run persistent SaaS video generation`.

### Task 5: Migrate Video Studio with explicit SaaS validation

**Files:**
- Modify: `packages/studio/src/components/VideoStudio.jsx`
- Modify: `packages/studio/src/models.js`
- Test: `tests/frontend/videoSaasClient.test.mjs`
- Test: `tests/providers/videoCapabilityValidation.test.mjs`

**Interfaces:**
- Consumes `generateSaasVideo`.
- Produces provider-ready parameters `{ aspectRatio, duration, resolution, seed, referenceImages, frameImages, referenceVideos }`.

- [ ] Write failing tests proving Video Studio no longer imports/calls `generateVideo`, `generateI2V`, or `processV2V`, and rejects a selected model when it lacks the requested mode/ratio/duration/resolution/reference capability.
- [ ] Run both tests; expect failure because legacy calls remain and capability validation does not exist.
- [ ] Add a small capability guard sourced from registered OpenRouter/direct video model metadata; migrate T2V, I2V, and V2V submissions to `generateSaasVideo`; keep UI model choices limited to supported SaaS models.
- [ ] Re-run tests; expect pass.
- [ ] Commit `feat(studio): submit durable SaaS video jobs`.

### Task 6: End-to-end regression verification

**Files:**
- Test: relevant tests from Tasks 1–5

- [ ] Run `node --test tests/frontend/saasMediaClient.test.mjs tests/frontend/cinemaSaasClient.test.mjs tests/frontend/influencerSaasClient.test.mjs tests/generations/saasVideoGeneration.test.mjs tests/queue/videoWorker.test.mjs tests/frontend/videoSaasClient.test.mjs tests/providers/videoCapabilityValidation.test.mjs`.
- [ ] Run `npm run build` and `git diff --check`.
- [ ] Rebuild only `nexoclip-app`, `nexoclip-image-worker`, and new video-worker with `docker compose up -d --build --no-deps --force-recreate`; do not recreate ai-ugc-owned Postgres, Redis, or AI Storyboard services.
- [ ] Check `docker compose ps` and worker logs; verify no provider secret appears in the diff.
- [ ] Commit `test(media): verify SaaS studio generation flows` if verification changes are needed.
