# Unified Job System — Plan 2: Migrate Remaining Features

**Status:** Design approved, ready for implementation plan. Depends on Plan 1
(`2026-08-19-unified-jobs-plan1-design.md`).

## Problem

Plan 1 built the durable job core, the global header job list, the refresh-safe
client, and migrated the video studio as the reference. Plan 2 migrates every
remaining async feature onto the same durable-job path so that **all** work is
durable, refresh-safe, and visible in the global list — then retires the
per-studio `localStorage` histories.

## What Plan 1 already provides (reused)

- `generation_jobs.kind` extended for `image/video/clipping/audio/workflow_node`.
- `jobService` (`createJob/getJob/listJobs/updateJobStatus`).
- `GET /api/jobs` + `GET /api/jobs/[id]`, the header job-list panel, and the
  shared refresh-safe client.
- The job `result` display contract
  `{ kind, title, thumbnailUrl?, outputUrl?, outputText? }`.

## Features to migrate

### 1. Image studio

- `POST /api/openrouter/images` creates a durable `image` job. Image generation
  is fast/synchronous, so the job is typically created already `succeeded` with
  the R2 URL in `result` — the first poll returns it. This keeps the studio's
  instant feel while still recording a durable, listed job.
- Cinema Studio and AI Influencer Studio (both image) go through the same path.

### 2. AI Clipping

- Replace the Python service's in-memory job store (lost on restart) with a
  durable `clipping` job in `generation_jobs`. The Next.js `/api/ai-clip/jobs`
  routes create/read the durable job; the Python service reports progress back
  (via a callback or by the Next worker polling it), and the final clip URLs land
  in the job `result`.
- This also fixes the existing restart-loses-jobs bug.

### 3. Audio

- Audio generation (lyria/gpt-audio via OpenRouter) creates a durable `audio`
  job, output persisted to R2 in `result`.

### 4. Workflow node runs

- The workflow single-node executor (from the workflow engine Plan 1) creates a
  durable `workflow_node` job, so node runs are refresh-safe and appear in the
  global list like everything else. (If the workflow engine is not yet built,
  this migration slots in when it is.)

## Retire per-studio localStorage history

- Once a feature is on durable jobs, its results are queryable via
  `GET /api/jobs?kind=<feature>`. Replace each studio's `localStorage`-backed
  history panel with a read of the durable job list (shared component), so
  history is server-side, cross-device, and consistent with the global list.
- Remove the now-dead per-studio persistence code (the debounced localStorage
  writes, the flush-on-unmount fixes, etc.) once each studio reads durable jobs.

## Data flow

Identical to Plan 1's durable-job flow — each migrated feature now calls
`createJob` and reports completion into the job `result`; the feature UI and the
global list both render from the same durable source; refresh reattaches.

## Error handling

- Each migrated feature keeps its existing provider-error contract (safe
  messages, no upstream URL/token leak) but surfaces it through the job `error`
  field and a failed badge.
- The clipping migration must preserve the current behavior where a single
  failed clip does not fail the whole job (partial results still returned in
  `result`).

## Testing

- Per-feature migration tests: submitting via each feature creates a durable job
  of the right kind, appears in `GET /api/jobs`, and completes with the correct
  `result` shape.
- Clipping durability test: a clip job survives a simulated service restart
  (state is in Postgres, not memory).
- History-panel tests: each studio's history now reads `GET /api/jobs?kind=...`
  and matches the global list.
- Regression: removing localStorage history does not break a studio's in-session
  display (it reads durable jobs instead).

## Non-goals (Plan 2)

- Websocket/SSE live updates (still polling).
- Job cancel/retry UI (future; state machine already supports `canceled`).
- Cross-feature job dependencies (that is the workflow engine's graph
  orchestration, not this system).
- Credit/billing changes (credit reservation already rides on `generation_jobs`;
  this plan does not alter it).
