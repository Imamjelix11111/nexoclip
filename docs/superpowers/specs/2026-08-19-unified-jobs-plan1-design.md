# Unified Job System — Plan 1: Job Core + Global Job List + Refresh-Safe

**Status:** Design approved, ready for implementation plan.

## Problem

Async work is fragmented across features and mostly not durable:

- **Storyboard** — already durable (`generation_jobs`, refresh-safe submit+poll).
- **Image studio** — synchronous, persists to R2 but creates no durable job,
  appears in no list.
- **Video studio** — browser-side submit+poll, not durable (a refresh loses the
  poll and the user loses track of the render).
- **AI Clipping** — job store is in-memory in the Python service (lost on
  restart), browser polls.
- **Workflow node runs** (planned) — will also need jobs.
- Each studio keeps its own history in `localStorage` (per-browser, per-studio,
  not shared across devices).
- There is **no global job list** — only `/api/admin/audit` (admin-only).

Goal: one durable job system for every feature, a global job list in the app
header/panel, and every request refresh-safe (a reload reattaches to the running
job instead of abandoning it).

Plan 1 builds the shared core + global list + refresh-safe client, and migrates
one reference feature (video). Plan 2 migrates the remaining features.

## What already exists (reused, not rebuilt)

- `generation_jobs` table: workspace-scoped, full state machine
  (`queued/running/succeeded/failed/canceled`), `kind`, `prompt`, `model`,
  `parameters` JSONB, `result` JSONB, `error` JSONB, timestamps; indexed by
  `(workspace_id, created_at)` and `(workspace_id, status)`.
- Its `kind` CHECK currently allows `image` + the three `vimax_*` kinds.
- `generationRepository` / `generationStateRepository` — row CRUD and state
  transitions.
- The storyboard's `vimaxWorkspaceState.ts` refresh-safe pattern (persist job id
  per session, reattach on load) — generalized here.

## Components

### 1. Unified job model

- Extend `generation_jobs.kind` CHECK (new migration) to cover all feature
  kinds: add `video`, `clipping`, `audio`, `workflow_node` alongside the
  existing `image` and `vimax_*`. `parameters`/`result`/`error` JSONB already
  hold any feature's payload, so no per-feature columns are needed.
- The `prompt`/`model` columns are image-era specifics; make them nullable (or
  move to `parameters`) so non-prompt jobs (clipping, workflow) fit cleanly.

### 2. Generic job service + repository

`src/services/jobService.js` (thin, over the existing repositories):

- `createJob({ workspaceId, kind, params }) → { id, status }`
- `getJob({ workspaceId, id }) → job` (workspace-scoped; 404 across tenants)
- `listJobs({ workspaceId, statuses?, limit, cursor }) → { jobs, nextCursor }`
- `updateJobStatus({ id, status, result?, error? })` — used by feature
  handlers/workers.

These wrap `generationRepository`/`generationStateRepository`; no new store.

### 3. Global job routes

- `GET /api/jobs` — list this workspace's jobs across all kinds, newest first,
  filterable by `status` (e.g. `?status=active` = queued+running). Paginated.
- `GET /api/jobs/[id]` — one job's status/result (workspace-scoped).

A job's `result` carries a small display contract every feature fills in:
`{ kind, title, thumbnailUrl?, outputUrl?, outputText? }` so the global list can
render any job type uniformly without knowing feature internals.

### 4. Global job list UI (header panel)

- A header control (bell/□ icon) opening a dropdown/panel that lists recent +
  active jobs for the workspace: kind icon, title, status badge, relative time,
  and a link to the result (open the studio / view the asset).
- Live updates by polling `GET /api/jobs?status=active` on a short interval
  while any job is active, then backing off. No websockets in Plan 1.
- Lives in the studio shell (`StandaloneShell`) so it is visible from every
  feature.

### 5. Refresh-safe shared client

- Generalize `vimaxWorkspaceState` into `src/lib/jobs/useDurableJob` (or a
  framework-agnostic helper): persist active job ids per workspace in
  `localStorage`, and on load reattach by polling `GET /api/jobs/[id]`.
- Server state is authoritative; local storage only remembers *which* jobs to
  reattach to. A refresh mid-job reattaches and keeps showing progress.

### 6. Reference migration: video studio

- `POST /api/openrouter/videos` creates a durable `video` job (status `queued`),
  returns its job id. The submit→poll→persist logic moves behind the job:
  polling `GET /api/jobs/[id]` reflects the OpenRouter video status; on
  completion the job's `result` holds the R2 URL.
- Video Studio uses the shared refresh-safe client and appears in the global
  list. This proves the pattern end-to-end before Plan 2 migrates the rest.

## Data flow (any durable job)

1. Feature route: `createJob({ kind, params })` → returns `{ id }`, starts the
   work (sync completes immediately; async continues server-side / via the
   existing worker).
2. Client stores the job id (refresh-safe) and polls `GET /api/jobs/[id]`.
3. The global header list polls `GET /api/jobs?status=active` and shows it too.
4. On completion the job's `result` (display contract + output URL) renders in
   both the feature UI and the global list. A refresh at any point reattaches.

## Error handling

- Job routes are workspace-scoped; a job from another workspace 404s.
- A failed job records a safe message in `error`; the list shows a failed badge,
  never crashes.
- Polling is defensive: a transient poll error does not drop the job (server
  remains the source of truth).

## Testing

- `jobService` tests: create/get/list/update, workspace isolation
  (no cross-tenant read), status filtering, pagination.
- `GET /api/jobs` / `GET /api/jobs/[id]` route tests (injected handlers): auth
  contract, workspace scoping, active-status filter.
- Refresh-safe client tests: reattach persists only ids, tolerates missing/
  malformed stored data, server result wins.
- Video reference-migration test: submitting a video creates a durable job,
  polling reflects completion with the R2 URL in `result`.

## Non-goals (Plan 1)

- Migrating image, clipping, audio, and workflow-node onto durable jobs — Plan 2.
- Retiring per-studio `localStorage` history — Plan 2 (kept in parallel until
  each feature is migrated).
- Websocket/SSE live updates (polling is enough for now).
- Job cancellation UI and retry-from-list (can be added later; the state
  machine already supports `canceled`).
