# Unified Job System — Plan 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate image generation and AI Clipping onto the durable job system built in Plan 1, and retire the per-studio localStorage history for the durable studios (image, video, clipping) in favor of the durable job list.

**Architecture:** Reuse Plan 1's `jobService` (`createJob`/`getJob`/`listJobs`/`updateJobStatus`), the `generation_jobs` table, the display contract `{ kind, title, thumbnailUrl?, outputUrl?, outputText? }`, and `durableJobStore`. Image generation is synchronous, so its job is created already `succeeded`. Clipping runs in the Python service (in-memory job store today), so a durable `clipping` job mirrors the Python job's terminal state — fixing the restart-loses-jobs bug. A shared history component reads `GET /api/jobs?kind=<feature>` and replaces the studios' localStorage history.

**Tech Stack:** Next.js 15 App Router route handlers (Node runtime, native `Response.json`, NOT `next/server` in new/edited job-creating handlers), raw PostgreSQL via `pg`, `node:test`, existing `resolveTenantContext`, Plan 1's `jobService`/`durableJobStore`.

**Scope note:** Audio and workflow-node migrations named in the Plan 2 spec are DEFERRED — there is no OpenRouter audio route yet (Audio Studio is still MuAPI) and the workflow engine is not built. Those migrations slot in when their prerequisites land. This plan covers image, clipping, and localStorage retirement only.

## Global Constraints

- All job routes derive workspace identity from the authenticated server session (`resolveTenantContext` with the `nexoclip_session` cookie + `x-workspace-id` header for the OpenRouter/ai-clip routes; the `/api/jobs` routes resolve from the session, no header). A job from another workspace must 404/no-op, never leak.
- Reuse Plan 1's `jobService` and the `generation_jobs` table; do not add a second jobs store.
- Every durable job's `result`, when set, includes the display contract `{ kind, title, thumbnailUrl?, outputUrl?, outputText? }`.
- New/edited job-creating handlers use native `Response.json(...)` and do NOT import `next/server` (matches Plan 1's `/api/jobs` routes and `vimax/sessions/route.js`).
- A job-mirror/update failure must NEVER break the primary response (wrap it best-effort), exactly as Plan 1's video poll route does.
- Tests run with `node --test <files>` from the repo root. Route handlers use the injected-handler factory pattern (see `tests/api/jobsRoute.test.mjs` / `videoJobMigration.test.mjs`); no live DB.
- Do NOT touch `package.json`. Never `git add -A`/`git add .` (unrelated untracked work exists). Run commands with `rtk` where a filter exists.
- localStorage retirement applies ONLY to the durable studios (image, video, clipping). MuAPI-only studios (lipsync, recast, marketing, vibe-motion) keep their localStorage history until they are migrated in future work.

---

## File Structure

| File | Responsibility |
|---|---|
| `nexoclip-app/src/services/jobService.js` (modify) | Add a `kind` filter to `listJobs`. |
| `nexoclip-app/src/repositories/jobRepository.js` (modify) | Support filtering `listJobs` by `kind`. |
| `nexoclip-app/app/api/jobs/route.js` (modify) | Accept `?kind=` and forward it to the service. |
| `nexoclip-app/app/api/openrouter/images/route.js` (modify) | Create a durable `image` job (already `succeeded`, with the display contract) on each generation. |
| `nexoclip-app/app/api/ai-clip/jobs/route.js` (modify) | Create a durable `clipping` job alongside the Python submit; return `job_id`. |
| `nexoclip-app/app/api/ai-clip/jobs/[id]/route.js` (modify) | Mirror the Python job's terminal state into the durable clipping job. |
| `nexoclip-app/packages/studio/src/muapi.js` (modify) | Clipping: remember/forget the durable job id for refresh-safety (like video). |
| `nexoclip-app/components/DurableJobHistory.js` (create) | Shared history panel: reads `GET /api/jobs?kind=<feature>` and renders results. |
| `nexoclip-app/src/lib/jobs/jobDisplay.js` (reuse) | `toJobListItem` — already exists from Plan 1. |
| `nexoclip-app/tests/...` | Unit + route tests per task. |

---

## Task 1: Add `?kind=` filter to the job list

**Files:**
- Modify: `nexoclip-app/src/repositories/jobRepository.js`
- Modify: `nexoclip-app/src/services/jobService.js`
- Modify: `nexoclip-app/app/api/jobs/route.js`
- Test: `nexoclip-app/tests/jobs/jobServiceKindFilter.test.mjs`, `nexoclip-app/tests/api/jobsRouteKind.test.mjs`

**Interfaces:**
- Consumes: Plan 1's `jobRepository.listJobs(client, { workspaceId, statuses, limit })` and `jobService.listJobs({ pool, workspaceId, statuses, limit })`.
- Produces: `listJobs` accepts an optional `kind` (string). `GET /api/jobs?kind=image` filters to that kind; combinable with `?status=active`.

- [ ] **Step 1: Write the failing service test**

```js
// nexoclip-app/tests/jobs/jobServiceKindFilter.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { listJobs } from '../../src/services/jobService.js';

function fakePool(rows) {
  return {
    async query(text, paramsArr) {
      // Assert the kind predicate is present and bound when a kind is passed.
      if (/kind = ANY|kind = \$/i.test(text)) {
        const kind = paramsArr.find((p) => p === 'image');
        return { rows: rows.filter((r) => r.kind === kind) };
      }
      return { rows };
    },
  };
}

test('listJobs filters by kind when provided', async () => {
  const rows = [
    { id: 'a', workspace_id: 'ws', kind: 'image', status: 'succeeded', parameters: {}, result: null, error: null, created_at: 't', updated_at: 't' },
    { id: 'b', workspace_id: 'ws', kind: 'video', status: 'running', parameters: {}, result: null, error: null, created_at: 't', updated_at: 't' },
  ];
  const { jobs } = await listJobs({ pool: fakePool(rows), workspaceId: 'ws', kind: 'image' });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, 'image');
});
```

- [ ] **Step 2: Run to verify RED**

Run: `rtk node --test nexoclip-app/tests/jobs/jobServiceKindFilter.test.mjs`
Expected: FAIL — `listJobs` ignores `kind`.

- [ ] **Step 3: Add `kind` to the repository**

In `nexoclip-app/src/repositories/jobRepository.js`, change `listJobs` to accept `kind`:

```js
export async function listJobs(client, { workspaceId, statuses = null, kind = null, limit = 50 }) {
  const where = ['workspace_id = $1'];
  const params = [workspaceId];
  if (statuses && statuses.length) { params.push(statuses); where.push(`status = ANY($${params.length})`); }
  if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
  params.push(limit);
  const result = await client.query(
    `SELECT ${RETURN_COLS} FROM generation_jobs
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}
```

- [ ] **Step 4: Thread `kind` through the service**

In `nexoclip-app/src/services/jobService.js`, change `listJobs`:

```js
export async function listJobs({ pool, workspaceId, statuses = null, kind = null, limit = 50 }) {
  const rows = await jobRepository.listJobs(pool, { workspaceId, statuses, kind, limit });
  return { jobs: rows.map(toJob) };
}
```

- [ ] **Step 5: Run the service test — GREEN**

Run: `rtk node --test nexoclip-app/tests/jobs/jobServiceKindFilter.test.mjs`
Expected: PASS.

- [ ] **Step 6: Write the failing route test**

```js
// nexoclip-app/tests/api/jobsRouteKind.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobsListHandler } from '../../app/api/jobs/route.js';

function req(url) {
  const r = new Request(url, { method: 'GET' });
  r.cookies = { get: (n) => (n === 'nexoclip_session' ? { value: 'tok' } : undefined) };
  return r;
}

test('forwards ?kind to the service', async () => {
  let seen;
  const handler = createJobsListHandler({
    getSession: async () => ({ user_id: 'u1' }), getWorkspace: async () => ({ id: 'ws-1' }), pool: {},
    listJobs: async ({ kind }) => { seen = kind; return { jobs: [] }; },
  });
  await handler(req('http://app/api/jobs?kind=image'));
  assert.equal(seen, 'image');
});
```

- [ ] **Step 7: Run to verify RED**

Run: `rtk node --test nexoclip-app/tests/api/jobsRouteKind.test.mjs`
Expected: FAIL — handler does not read `kind`.

- [ ] **Step 8: Read `?kind` in the route**

In `nexoclip-app/app/api/jobs/route.js`, inside the handler after computing `statuses`, add:

```js
    const kind = url.searchParams.get('kind') || null;
    const { jobs } = await listJobs({ pool, workspaceId: workspace.id, statuses, kind });
```

(Replace the existing `listJobs({ pool, workspaceId: workspace.id, statuses })` call.)

- [ ] **Step 9: Run both tests — GREEN**

Run: `rtk node --test nexoclip-app/tests/api/jobsRouteKind.test.mjs nexoclip-app/tests/api/jobsRoute.test.mjs nexoclip-app/tests/jobs/jobServiceKindFilter.test.mjs`
Expected: all PASS (existing jobsRoute tests still green).

- [ ] **Step 10: Commit**

```bash
rtk git add nexoclip-app/src/repositories/jobRepository.js nexoclip-app/src/services/jobService.js nexoclip-app/app/api/jobs/route.js nexoclip-app/tests/jobs/jobServiceKindFilter.test.mjs nexoclip-app/tests/api/jobsRouteKind.test.mjs
rtk git commit -m "feat: filter the job list by kind"
```

---

## Task 2: Image durable job migration

**Files:**
- Modify: `nexoclip-app/app/api/openrouter/images/route.js`
- Test: `nexoclip-app/tests/api/imageJobMigration.test.mjs`

**Interfaces:**
- Consumes: `jobService.createJob`, `jobService.updateJobStatus`; the existing `createOpenRouterImageAdapter` + `persistGeneratedImage`.
- Produces: `createImageHandler({ resolveTenant, env, generate, persist, createJob, updateJobStatus })` factory. On success it creates a durable `image` job already `succeeded` with `result = { kind:'image', title:'Image generation', outputUrl, thumbnailUrl: outputUrl }`, and returns the existing response body plus `job_id`.

- [ ] **Step 1: Write the failing test**

```js
// nexoclip-app/tests/api/imageJobMigration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageHandler } from '../../app/api/openrouter/images/route.js';

function postReq(body) {
  const r = new Request('http://app/api/openrouter/images', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
    body: JSON.stringify(body),
  });
  r.cookies = { get: (n) => (n === 'nexoclip_session' ? { value: 'tok' } : undefined) };
  return r;
}

test('a successful image generation creates a succeeded image job with the display contract', async () => {
  let created; let updated;
  const handler = createImageHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }),
    env: { OPENROUTER_API_KEY: 'k' },
    generate: async () => ({ outputs: [{ url: 'data:image/png;base64,AAAA', mimeType: 'image/png' }] }),
    persist: async () => ({ id: 'asset-1', url: 'https://assets/x.png' }),
    createJob: async ({ workspaceId, kind }) => { created = { workspaceId, kind }; return { id: 'job-1', status: 'queued' }; },
    updateJobStatus: async (args) => { updated = args; return { id: 'job-1', status: 'succeeded' }; },
  });
  const res = await handler(postReq({ model: 'nano-banana', prompt: 'a cat' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.job_id, 'job-1');
  assert.deepEqual(created, { workspaceId: 'ws-1', kind: 'image' });
  assert.equal(updated.status, 'succeeded');
  assert.equal(updated.result.kind, 'image');
  assert.equal(updated.result.outputUrl, 'https://assets/x.png');
});

test('missing model/prompt is 400 before any job is created', async () => {
  let calls = 0;
  const handler = createImageHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }), env: { OPENROUTER_API_KEY: 'k' },
    generate: async () => ({ outputs: [] }), persist: async () => ({}),
    createJob: async () => { calls += 1; return { id: 'j' }; }, updateJobStatus: async () => ({}),
  });
  const res = await handler(postReq({ prompt: 'no model' }));
  assert.equal(res.status, 400);
  assert.equal(calls, 0);
});
```

- [ ] **Step 2: Run to verify RED**

Run: `rtk node --test nexoclip-app/tests/api/imageJobMigration.test.mjs`
Expected: FAIL — `createImageHandler` not exported.

- [ ] **Step 3: Refactor the image route into an injectable handler**

Rewrite `nexoclip-app/app/api/openrouter/images/route.js` to export `createImageHandler({ resolveTenant, env, generate, persist, createJob, updateJobStatus })` with defaults wired to the real `resolveTenantContext`, `process.env`, `createOpenRouterImageAdapter(...).generate`, `persistGeneratedImage`, `jobService.createJob`, `jobService.updateJobStatus`, and `getPool()` for the pool. Use native `Response.json` (drop `next/server`). The handler:
1. Validates `env.OPENROUTER_API_KEY` (503) and body `{ model, prompt }` (400) BEFORE creating any job.
2. Resolves the tenant.
3. Calls `generate(...)`, persists each output (existing logic), collecting `outputs` (the existing response shape, each `{ ...persisted, mimeType }`).
4. `createJob({ pool, workspaceId, kind: 'image', params: { model, prompt } })`, then `updateJobStatus({ pool, workspaceId, id: job.id, status: 'succeeded', result: { kind: 'image', title: 'Image generation', outputUrl: outputs[0]?.url ?? null, thumbnailUrl: outputs[0]?.url ?? null } })`. Wrap the job create+update best-effort so a job failure never breaks the image response.
5. Returns `200 { ...result, outputs, job_id: job?.id ?? null }`.

Keep `export const POST = createImageHandler();`.

- [ ] **Step 4: Run to verify GREEN**

Run: `rtk node --test nexoclip-app/tests/api/imageJobMigration.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify build**

Run: `rtk npm --prefix nexoclip-app run build`
Expected: succeeds; `/api/openrouter/images` still listed.

- [ ] **Step 6: Commit**

```bash
rtk git add nexoclip-app/app/api/openrouter/images/route.js nexoclip-app/tests/api/imageJobMigration.test.mjs
rtk git commit -m "feat: make image generation a durable, listed job"
```

---

## Task 3: Clipping durable job migration

**Files:**
- Modify: `nexoclip-app/app/api/ai-clip/jobs/route.js`
- Modify: `nexoclip-app/app/api/ai-clip/jobs/[id]/route.js`
- Modify: `nexoclip-app/packages/studio/src/muapi.js`
- Test: `nexoclip-app/tests/api/clipJobMigration.test.mjs`

**Interfaces:**
- Consumes: `jobService.createJob`, `jobService.updateJobStatus`; `durableJobStore` (`rememberActiveJob`/`forgetActiveJob`).
- Produces: `createClipSubmitHandler({ resolveTenant, env, submitClip, createJob })` — on a successful Python submit it creates a durable `clipping` job and returns `202 { id: pythonJobId, job_id, status: 'queued' }`. The `[id]` poll route mirrors the Python terminal state into the durable job's `result = { kind:'clipping', title:'AI clipping', outputUrl: firstClipUrl }`.

- [ ] **Step 1: Write the failing test**

```js
// nexoclip-app/tests/api/clipJobMigration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClipSubmitHandler } from '../../app/api/ai-clip/jobs/route.js';

function postReq(body) {
  const r = new Request('http://app/api/ai-clip/jobs', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
    body: JSON.stringify(body),
  });
  r.cookies = { get: (n) => (n === 'nexoclip_session' ? { value: 'tok' } : undefined) };
  return r;
}

test('submitting a clip job creates a durable clipping job and returns its id', async () => {
  let created;
  const handler = createClipSubmitHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }),
    env: { AI_CLIP_RUNTIME_URL: 'http://clip', AI_CLIP_RUNTIME_TOKEN: 'secret' },
    submitClip: async () => ({ id: 'py-1', status: 'pending' }),
    createJob: async ({ workspaceId, kind }) => { created = { workspaceId, kind }; return { id: 'job-1', status: 'queued' }; },
  });
  const res = await handler(postReq({ video_url: 'https://v/x.mp4' }));
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.job_id, 'job-1');
  assert.equal(body.id, 'py-1');
  assert.deepEqual(created, { workspaceId: 'ws-1', kind: 'clipping' });
});

test('missing video_url is 400 before any job is created', async () => {
  let calls = 0;
  const handler = createClipSubmitHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }),
    env: { AI_CLIP_RUNTIME_URL: 'http://clip', AI_CLIP_RUNTIME_TOKEN: 'secret' },
    submitClip: async () => ({ id: 'py' }), createJob: async () => { calls += 1; return { id: 'j' }; },
  });
  const res = await handler(postReq({}));
  assert.equal(res.status, 400);
  assert.equal(calls, 0);
});
```

- [ ] **Step 2: Run to verify RED**

Run: `rtk node --test nexoclip-app/tests/api/clipJobMigration.test.mjs`
Expected: FAIL — `createClipSubmitHandler` not exported.

- [ ] **Step 3: Refactor the clip submit route into an injectable handler**

Rewrite `nexoclip-app/app/api/ai-clip/jobs/route.js` to export `createClipSubmitHandler({ resolveTenant, env, submitClip, createJob })` (defaults: real `resolveTenantContext`; `process.env`; `submitClip` = the existing fetch to `${AI_CLIP_RUNTIME_URL}/internal/v1/clip-jobs` returning the parsed JSON; `jobService.createJob`; `getPool()`). Use native `Response.json` (drop `next/server`). Order:
1. Validate `env.AI_CLIP_RUNTIME_URL`/`AI_CLIP_RUNTIME_TOKEN` (503) and body `{ video_url }` (400) BEFORE creating any job.
2. Resolve tenant.
3. `submitClip(...)` → `{ id: pythonJobId }`. On failure return the existing 502.
4. `createJob({ pool, workspaceId, kind: 'clipping', params: { pythonJobId, video_url, num_clips, aspect_ratio } })`.
5. Return `202 { id: pythonJobId, job_id: job.id, status: 'queued' }`. Wrap createJob best-effort: if it throws, still return the Python id (clip still runs), with `job_id: null`.

Keep `export const POST = createClipSubmitHandler();`.

- [ ] **Step 4: Run to verify GREEN**

Run: `rtk node --test nexoclip-app/tests/api/clipJobMigration.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Mirror the Python terminal state in the poll route**

In `nexoclip-app/app/api/ai-clip/jobs/[id]/route.js`, accept `?job_id=` (durable id). After fetching the Python status: when Python `status === 'completed'`, best-effort `updateJobStatus({ pool: getPool(), workspaceId, id: jobId, status: 'succeeded', result: { kind: 'clipping', title: 'AI clipping', outputUrl: (shorts?.find((s) => s.url)?.url) ?? null } })`; when `status === 'failed'`, `updateJobStatus(..., status: 'failed', error: { message: 'Clipping failed' })`. Guard so a job-update failure does not break the poll response. (Use the same `markJobStatus`-style wrapper as the video poll route.)

- [ ] **Step 6: Wire Clipping Studio remember/forget**

In `nexoclip-app/packages/studio/src/muapi.js` `runClipping`, capture `job_id` from the submit response as `durableJobId`; on submit `rememberActiveJob(params.workspace_id, durableJobId, window.localStorage)` (guarded by `durableJobId && params.workspace_id && window.localStorage`), and on terminal poll status `forgetActiveJob(...)`. Append `?job_id=${encodeURIComponent(durableJobId)}` to the poll URL when present. Import from `../../../src/lib/jobs/durableJobStore.js` (the path already used for video in this file).

- [ ] **Step 7: Run focused suite + build**

```bash
rtk node --test nexoclip-app/tests/api/clipJobMigration.test.mjs nexoclip-app/tests/api/jobsRoute.test.mjs nexoclip-app/tests/api/videoJobMigration.test.mjs
rtk npm --prefix nexoclip-app run build:studio
rtk npm --prefix nexoclip-app run build
```
Expected: all pass; both builds succeed (pre-existing bullmq/valkey warning acceptable).

- [ ] **Step 8: Commit**

```bash
rtk git add nexoclip-app/app/api/ai-clip/jobs/route.js "nexoclip-app/app/api/ai-clip/jobs/[id]/route.js" nexoclip-app/packages/studio/src/muapi.js nexoclip-app/tests/api/clipJobMigration.test.mjs
rtk git commit -m "feat: make AI clipping a durable, refresh-safe, listed job"
```

---

## Task 4: Shared durable history + retire localStorage for durable studios

**Files:**
- Create: `nexoclip-app/components/DurableJobHistory.js`
- Modify: `nexoclip-app/packages/studio/src/components/ImageStudio.jsx`
- Modify: `nexoclip-app/packages/studio/src/components/ClippingStudio.jsx`
- Modify: `nexoclip-app/packages/studio/src/components/VideoStudio.jsx`
- Test: `nexoclip-app/tests/jobs/durableHistoryShape.test.mjs`

**Interfaces:**
- Consumes: `GET /api/jobs?kind=<feature>` (Task 1), `toJobListItem` (`src/lib/jobs/jobDisplay.js`).
- Produces: `historyItemsFromJobs(jobs) → [{ id, url, title, kind }]` pure helper (drops jobs without an outputUrl), and a `<DurableJobHistory kind="image" />` component reading the durable job list.

- [ ] **Step 1: Write the failing pure-helper test**

```js
// nexoclip-app/tests/jobs/durableHistoryShape.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { historyItemsFromJobs } from '../../components/DurableJobHistory.js';

test('keeps only succeeded jobs with an output url, newest-first order preserved', () => {
  const jobs = [
    { id: 'a', kind: 'image', status: 'succeeded', result: { kind: 'image', title: 'One', outputUrl: 'https://x/a.png' } },
    { id: 'b', kind: 'image', status: 'running', result: null },
    { id: 'c', kind: 'image', status: 'succeeded', result: { kind: 'image', title: 'Two', outputUrl: 'https://x/c.png' } },
  ];
  const items = historyItemsFromJobs(jobs);
  assert.deepEqual(items, [
    { id: 'a', url: 'https://x/a.png', title: 'One', kind: 'image' },
    { id: 'c', url: 'https://x/c.png', title: 'Two', kind: 'image' },
  ]);
});
```

- [ ] **Step 2: Run to verify RED**

Run: `rtk node --test nexoclip-app/tests/jobs/durableHistoryShape.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the shared component + pure helper**

```js
// nexoclip-app/components/DurableJobHistory.js
'use client';

import { useEffect, useState } from 'react';
import { toJobListItem } from '../src/lib/jobs/jobDisplay.js';

// Pure: map durable jobs to history entries, keeping only those with a real output.
export function historyItemsFromJobs(jobs) {
  return (jobs || [])
    .map(toJobListItem)
    .filter((it) => it.outputUrl)
    .map((it) => ({ id: it.id, url: it.outputUrl, title: it.title, kind: it.kind }));
}

// Reads the durable job list for one feature kind, replacing per-studio localStorage history.
export default function DurableJobHistory({ kind, onSelect }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/jobs?kind=${encodeURIComponent(kind)}`, { credentials: 'include' });
        if (!res.ok) return;
        const { jobs } = await res.json();
        if (!cancelled) setItems(historyItemsFromJobs(jobs));
      } catch { /* transient — keep last */ }
    }
    load();
    const timer = window.setInterval(load, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [kind]);

  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      {items.map((it) => (
        <button key={it.id} type="button" onClick={() => onSelect?.(it)} className="overflow-hidden rounded-lg border border-white/10 hover:border-white/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={it.url} alt={it.title} className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify GREEN**

Run: `rtk node --test nexoclip-app/tests/jobs/durableHistoryShape.test.mjs`
Expected: PASS.

- [ ] **Step 5: Retire localStorage history in ImageStudio**

In `nexoclip-app/packages/studio/src/components/ImageStudio.jsx`: remove the `localStorage`-backed history read/write effects (the `PERSIST_KEY` load effect and the debounced-save effect) and render `<DurableJobHistory kind="image" onSelect={...} />` where the history grid was, wiring `onSelect` to the existing "load a past result into the canvas" handler. Keep the in-session generated-results display intact (that is separate from the persisted history). Import: `import DurableJobHistory from '../../../../components/DurableJobHistory.js';` (verify the relative depth from this file resolves to `nexoclip-app/components/DurableJobHistory.js`; adjust the `../` count if needed).

- [ ] **Step 6: Retire localStorage history in ClippingStudio and VideoStudio**

Apply the identical change to `ClippingStudio.jsx` (`kind="clipping"`) and `VideoStudio.jsx` (`kind="video"`): remove their `localStorage`/`PERSIST_KEY` history load+save effects (including the earlier flush-on-unmount effects) and render `<DurableJobHistory kind="..." onSelect={...} />` in place of the localStorage history panel. Do not remove non-history persistence (e.g. the currently-selected model/settings) if it is separate; remove only the generated-results history persistence.

- [ ] **Step 7: Verify build + full focused suite**

```bash
rtk node --test nexoclip-app/tests/jobs/durableHistoryShape.test.mjs nexoclip-app/tests/api/jobsRoute.test.mjs nexoclip-app/tests/api/jobsRouteKind.test.mjs nexoclip-app/tests/api/imageJobMigration.test.mjs nexoclip-app/tests/api/clipJobMigration.test.mjs
rtk npm --prefix nexoclip-app run build:studio
rtk npm --prefix nexoclip-app run build
```
Expected: all pass; both builds succeed.

- [ ] **Step 8: Commit**

```bash
rtk git add nexoclip-app/components/DurableJobHistory.js nexoclip-app/packages/studio/src/components/ImageStudio.jsx nexoclip-app/packages/studio/src/components/ClippingStudio.jsx nexoclip-app/packages/studio/src/components/VideoStudio.jsx nexoclip-app/tests/jobs/durableHistoryShape.test.mjs
rtk git commit -m "feat: read studio history from durable jobs, retire localStorage history"
```

---

## Plan Self-Review

- **Coverage:** Task 1 = `?kind=` filter (needed for per-studio history reads); Task 2 = image durable migration (spec §1); Task 3 = clipping durable migration incl. the in-memory→durable fix (spec §2); Task 4 = shared durable history + localStorage retirement (spec "Retire per-studio localStorage history"). Audio (spec §3) and workflow-node (spec §4) are explicitly deferred in the Scope note — their prerequisites (OpenRouter audio route, workflow engine) do not exist yet.
- **Type consistency:** `listJobs`'s new `kind` param is defined in Task 1 and consumed by `DurableJobHistory`'s `?kind=` fetch in Task 4. The display contract `{ kind, title, thumbnailUrl?, outputUrl?, outputText? }` is written by Tasks 2 (image) and 3 (clipping) and consumed by `toJobListItem` → `historyItemsFromJobs` in Task 4. `createImageHandler`/`createClipSubmitHandler` mirror Plan 1's `createVideoSubmitHandler` factory shape.
- **Constraint adherence:** new/edited job-creating handlers use native `Response.json` (Tasks 2, 3); job-mirror updates are best-effort wrapped (Tasks 2, 3, 5); workspace scoping preserved via `resolveTenantContext`; package.json untouched.
- **Deferred/at-risk:** Task 4's localStorage-removal touches three studio files with per-file structure; the implementer must remove ONLY the generated-results history persistence, not unrelated settings persistence — the task text says so explicitly and the reviewer should verify no non-history state was dropped.
