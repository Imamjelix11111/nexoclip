# Unified Job System — Plan 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one durable job core over the existing `generation_jobs` table, expose a workspace-scoped global job list (`GET /api/jobs`, `GET /api/jobs/[id]`), add a refresh-safe shared client, and migrate the video studio onto it as the reference feature.

**Architecture:** Reuse the existing `generation_jobs` Postgres table and its repositories rather than inventing a new store. A thin `jobService` wraps row create/read/list/update. Two new Next.js route handlers expose the list and single-job reads using the established injected-handler pattern. A pure, DOM-free client helper (generalized from the storyboard's `vimaxWorkspaceState`) persists active job ids and reattaches on load. The video route creates a durable `video` job whose `result` carries a uniform display contract.

**Tech Stack:** Next.js 15 App Router route handlers (Node runtime, ESM), raw PostgreSQL via `pg`, `node:test` + `node:assert/strict`, existing `resolveTenantContext` auth, existing `generationRepository`/`generationStateRepository`.

## Global Constraints

- All job routes derive workspace identity from the authenticated server session (`resolveTenantContext` with the `nexoclip_session` cookie); the browser never supplies a trusted workspace id in the body. A job from another workspace must 404, never leak.
- Reuse the existing `generation_jobs` table and `generationRepository`/`generationStateRepository`; do not create a second jobs table.
- The generic job path must NOT require the credit-reservation / BullMQ / claim-fencing machinery — that pipeline is only for metered generations. A plain durable job is a direct row insert with `status='queued'`.
- Every job's `result` JSONB, when set, includes the display contract `{ kind, title, thumbnailUrl?, outputUrl?, outputText? }` so the global list renders any kind uniformly.
- Tests run with `node --test <files>` from the `nexoclip-app` directory. Route handlers are tested with the injected-handler factory pattern (see `tests/api/vimaxSessionsRoute.test.mjs`), never against a live DB.
- Preserve all unrelated in-progress work (queue claim fencing, credit, billing, workflow specs). Touch only the files each task names.
- Run commands with `rtk` where a filter exists (e.g. `rtk node --test ...`, `rtk git ...`).

---

## File Structure

| File | Responsibility |
|---|---|
| `nexoclip-app/src/db/migrations/020_unified_jobs.sql` | Extend `generation_jobs.kind` CHECK to all feature kinds; drop NOT NULL on `prompt`/`model` so non-prompt jobs fit. |
| `nexoclip-app/src/repositories/jobRepository.js` | New minimal SQL: insert a plain durable job, list jobs by workspace/status, read one. Sits beside `generationRepository`, does not duplicate its metered-generation inserts. |
| `nexoclip-app/src/services/jobService.js` | Thin API: `createJob`, `getJob`, `listJobs`, `updateJobStatus`; injects a pool for testing. |
| `nexoclip-app/app/api/jobs/route.js` | `GET /api/jobs` — workspace-scoped list, `?status=active` filter. Injected-handler factory. |
| `nexoclip-app/app/api/jobs/[id]/route.js` | `GET /api/jobs/[id]` — one job, workspace-scoped. Injected-handler factory. |
| `nexoclip-app/src/lib/jobs/durableJobStore.js` | Pure, DOM-free: persist/restore active job ids per workspace; tolerant of bad storage. Generalized from `vimaxWorkspaceState`. |
| `nexoclip-app/components/JobListPanel.js` | Header panel component: polls `GET /api/jobs?status=active`, renders the display contract. Mounted in `StandaloneShell`. |
| `nexoclip-app/app/api/openrouter/videos/route.js` (modify) | Create a durable `video` job on submit; return its job id. |
| `nexoclip-app/app/api/openrouter/videos/[id]/route.js` (modify) | On completion, write the display contract into the job `result`. |
| `nexoclip-app/tests/...` | Unit + route tests per task (paths given in each task). |

---

## Task 1: Migration — extend `kind`, relax `prompt`/`model`

**Files:**
- Create: `nexoclip-app/src/db/migrations/020_unified_jobs.sql`
- Test: `nexoclip-app/tests/db/unifiedJobsMigration.test.mjs`

**Interfaces:**
- Produces: `generation_jobs` accepts `kind IN ('image','video','clipping','audio','workflow_node','vimax_narrative_planning','vimax_novel_planning','vimax_render_video')`; `prompt` and `model` are nullable.

- [ ] **Step 1: Write the failing test**

```js
// nexoclip-app/tests/db/unifiedJobsMigration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../src/db/migrations/020_unified_jobs.sql', import.meta.url), 'utf8');

test('kind check includes every feature kind', () => {
  for (const kind of ['image', 'video', 'clipping', 'audio', 'workflow_node',
    'vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video']) {
    assert.match(sql, new RegExp(`'${kind.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}'`));
  }
});

test('prompt and model are made nullable', () => {
  assert.match(sql, /ALTER COLUMN prompt DROP NOT NULL/i);
  assert.match(sql, /ALTER COLUMN model DROP NOT NULL/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk node --test nexoclip-app/tests/db/unifiedJobsMigration.test.mjs`
Expected: FAIL — file `020_unified_jobs.sql` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- nexoclip-app/src/db/migrations/020_unified_jobs.sql
-- Generalize generation_jobs into the unified job store: every feature's async
-- work is a row here. Widen the kind whitelist and relax prompt/model (image-era
-- NOT NULL columns) so non-prompt jobs (clipping, workflow_node) fit.
ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_kind_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_kind_check
  CHECK (kind IN (
    'image', 'video', 'clipping', 'audio', 'workflow_node',
    'vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video'
  ));

ALTER TABLE generation_jobs ALTER COLUMN prompt DROP NOT NULL;
ALTER TABLE generation_jobs ALTER COLUMN model DROP NOT NULL;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk node --test nexoclip-app/tests/db/unifiedJobsMigration.test.mjs`
Expected: PASS.

- [ ] **Step 5: Apply the migration to the dev DB**

Run: `rtk node nexoclip-app/src/db/migrate.js`
Expected: "Database migrations applied." (020 applied; re-runnable safely).

- [ ] **Step 6: Commit**

```bash
rtk git add nexoclip-app/src/db/migrations/020_unified_jobs.sql nexoclip-app/tests/db/unifiedJobsMigration.test.mjs
rtk git commit -m "feat: widen generation_jobs into the unified job store"
```

---

## Task 2: `jobRepository` + `jobService`

**Files:**
- Create: `nexoclip-app/src/repositories/jobRepository.js`
- Create: `nexoclip-app/src/services/jobService.js`
- Test: `nexoclip-app/tests/jobs/jobService.test.mjs`

**Interfaces:**
- Consumes: a `pool`/`client` with `.query(text, params) → { rows }` (pg-compatible).
- Produces:
  - `jobRepository.insertJob(client, { workspaceId, kind, params }) → row`
  - `jobRepository.findJob(client, workspaceId, id) → row | null`
  - `jobRepository.listJobs(client, { workspaceId, statuses, limit }) → rows`
  - `jobRepository.updateJob(client, { workspaceId, id, status, result, error }) → row | null`
  - `jobService.createJob({ pool, workspaceId, kind, params }) → { id, status }`
  - `jobService.getJob({ pool, workspaceId, id }) → job | null`
  - `jobService.listJobs({ pool, workspaceId, statuses, limit }) → { jobs }`
  - `jobService.updateJobStatus({ pool, workspaceId, id, status, result, error }) → job | null`
  - Job shape returned to callers: `{ id, kind, status, params, result, error, createdAt, updatedAt }`.

- [ ] **Step 1: Write the failing test**

```js
// nexoclip-app/tests/jobs/jobService.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJob, getJob, listJobs, updateJobStatus } from '../../src/services/jobService.js';

// Minimal in-memory fake of a pg pool for the SQL our repo issues.
function fakePool() {
  const rows = [];
  let seq = 0;
  return {
    rows,
    async query(text, paramsArr) {
      if (/INSERT INTO generation_jobs/i.test(text)) {
        const [workspaceId, kind, params] = paramsArr;
        const row = {
          id: `job-${++seq}`, workspace_id: workspaceId, kind, status: 'queued',
          parameters: params, result: null, error: null,
          created_at: 't0', updated_at: 't0',
        };
        rows.push(row);
        return { rows: [row] };
      }
      if (/WHERE workspace_id = \$1 AND id = \$2/i.test(text)) {
        const [workspaceId, id] = paramsArr;
        return { rows: rows.filter((r) => r.workspace_id === workspaceId && r.id === id) };
      }
      if (/UPDATE generation_jobs/i.test(text)) {
        const [workspaceId, id, status, result, error] = paramsArr;
        const row = rows.find((r) => r.workspace_id === workspaceId && r.id === id);
        if (!row) return { rows: [] };
        Object.assign(row, { status, result, error, updated_at: 't1' });
        return { rows: [row] };
      }
      // list
      const [workspaceId] = paramsArr;
      return { rows: rows.filter((r) => r.workspace_id === workspaceId) };
    },
  };
}

test('createJob inserts a queued job scoped to the workspace', async () => {
  const pool = fakePool();
  const job = await createJob({ pool, workspaceId: 'ws-1', kind: 'video', params: { prompt: 'a cat' } });
  assert.equal(job.status, 'queued');
  assert.equal(job.id, 'job-1');
});

test('getJob only returns a job in the same workspace', async () => {
  const pool = fakePool();
  const created = await createJob({ pool, workspaceId: 'ws-1', kind: 'video', params: {} });
  assert.equal((await getJob({ pool, workspaceId: 'ws-1', id: created.id })).id, created.id);
  assert.equal(await getJob({ pool, workspaceId: 'ws-2', id: created.id }), null);
});

test('updateJobStatus writes result and status', async () => {
  const pool = fakePool();
  const created = await createJob({ pool, workspaceId: 'ws-1', kind: 'video', params: {} });
  const done = await updateJobStatus({
    pool, workspaceId: 'ws-1', id: created.id, status: 'succeeded',
    result: { kind: 'video', title: 'Render', outputUrl: 'https://x/y.mp4' },
  });
  assert.equal(done.status, 'succeeded');
  assert.equal(done.result.outputUrl, 'https://x/y.mp4');
});

test('listJobs returns only this workspace jobs', async () => {
  const pool = fakePool();
  await createJob({ pool, workspaceId: 'ws-1', kind: 'video', params: {} });
  await createJob({ pool, workspaceId: 'ws-2', kind: 'image', params: {} });
  const { jobs } = await listJobs({ pool, workspaceId: 'ws-1' });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, 'video');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk node --test nexoclip-app/tests/jobs/jobService.test.mjs`
Expected: FAIL — `jobService.js` does not exist.

- [ ] **Step 3: Write the repository**

```js
// nexoclip-app/src/repositories/jobRepository.js
const RETURN_COLS = 'id, workspace_id, kind, status, parameters, result, error, created_at, updated_at';

export async function insertJob(client, { workspaceId, kind, params }) {
  const result = await client.query(
    `INSERT INTO generation_jobs (workspace_id, kind, status, parameters)
     VALUES ($1, $2, 'queued', $3)
     RETURNING ${RETURN_COLS}`,
    [workspaceId, kind, params ?? {}],
  );
  return result.rows[0];
}

export async function findJob(client, workspaceId, id) {
  const result = await client.query(
    `SELECT ${RETURN_COLS} FROM generation_jobs
     WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
    [workspaceId, id],
  );
  return result.rows[0] || null;
}

export async function listJobs(client, { workspaceId, statuses = null, limit = 50 }) {
  if (statuses && statuses.length) {
    const result = await client.query(
      `SELECT ${RETURN_COLS} FROM generation_jobs
       WHERE workspace_id = $1 AND status = ANY($2)
       ORDER BY created_at DESC LIMIT $3`,
      [workspaceId, statuses, limit],
    );
    return result.rows;
  }
  const result = await client.query(
    `SELECT ${RETURN_COLS} FROM generation_jobs
     WHERE workspace_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [workspaceId, limit],
  );
  return result.rows;
}

export async function updateJob(client, { workspaceId, id, status, result = null, error = null }) {
  const res = await client.query(
    `UPDATE generation_jobs
     SET status = $3, result = $4, error = $5, updated_at = now()
     WHERE workspace_id = $1 AND id = $2
     RETURNING ${RETURN_COLS}`,
    [workspaceId, id, status, result, error],
  );
  return res.rows[0] || null;
}
```

- [ ] **Step 4: Write the service**

```js
// nexoclip-app/src/services/jobService.js
import * as jobRepository from '../repositories/jobRepository.js';

function toJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    params: row.parameters ?? {},
    result: row.result ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createJob({ pool, workspaceId, kind, params }) {
  return toJob(await jobRepository.insertJob(pool, { workspaceId, kind, params }));
}

export async function getJob({ pool, workspaceId, id }) {
  return toJob(await jobRepository.findJob(pool, workspaceId, id));
}

export async function listJobs({ pool, workspaceId, statuses = null, limit = 50 }) {
  const rows = await jobRepository.listJobs(pool, { workspaceId, statuses, limit });
  return { jobs: rows.map(toJob) };
}

export async function updateJobStatus({ pool, workspaceId, id, status, result = null, error = null }) {
  return toJob(await jobRepository.updateJob(pool, { workspaceId, id, status, result, error }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk node --test nexoclip-app/tests/jobs/jobService.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
rtk git add nexoclip-app/src/repositories/jobRepository.js nexoclip-app/src/services/jobService.js nexoclip-app/tests/jobs/jobService.test.mjs
rtk git commit -m "feat: add generic job service over the unified job store"
```

---

## Task 3: Global job routes (`GET /api/jobs`, `GET /api/jobs/[id]`)

**Files:**
- Create: `nexoclip-app/app/api/jobs/route.js`
- Create: `nexoclip-app/app/api/jobs/[id]/route.js`
- Test: `nexoclip-app/tests/api/jobsRoute.test.mjs`

**Interfaces:**
- Consumes: `jobService.listJobs`, `jobService.getJob`; `SESSION_COOKIE`, `getCurrentSession`, `getDefaultWorkspace`.
- Produces:
  - `createJobsListHandler({ getSession, getWorkspace, listJobs, pool }) → (request) => Response` returning `{ jobs }`.
  - `createJobGetHandler({ getSession, getWorkspace, getJob, pool }) → (request, { params }) => Response` returning the job or 404.
  - Active filter: `?status=active` → statuses `['queued','running']`.

- [ ] **Step 1: Write the failing test**

```js
// nexoclip-app/tests/api/jobsRoute.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobsListHandler } from '../../app/api/jobs/route.js';
import { createJobGetHandler } from '../../app/api/jobs/[id]/route.js';

function req(url, headers = {}) {
  const request = new Request(url, { method: 'GET', headers });
  request.cookies = { get: (n) => (n === 'nexoclip_session' ? { value: 'tok' } : undefined) };
  return request;
}
const okSession = async () => ({ user_id: 'u1', email: 'a@b.c' });
const okWorkspace = async () => ({ id: 'ws-1' });

test('lists jobs for the authenticated workspace only', async () => {
  const handler = createJobsListHandler({
    getSession: okSession, getWorkspace: okWorkspace, pool: {},
    listJobs: async ({ workspaceId }) => {
      assert.equal(workspaceId, 'ws-1');
      return { jobs: [{ id: 'j1', kind: 'video', status: 'running' }] };
    },
  });
  const res = await handler(req('http://app/api/jobs'));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).jobs[0].id, 'j1');
});

test('active filter maps to queued+running', async () => {
  let seen;
  const handler = createJobsListHandler({
    getSession: okSession, getWorkspace: okWorkspace, pool: {},
    listJobs: async ({ statuses }) => { seen = statuses; return { jobs: [] }; },
  });
  await handler(req('http://app/api/jobs?status=active'));
  assert.deepEqual(seen, ['queued', 'running']);
});

test('unauthenticated list is 401', async () => {
  const handler = createJobsListHandler({
    getSession: async () => null, getWorkspace: okWorkspace, listJobs: async () => ({ jobs: [] }), pool: {},
  });
  assert.equal((await handler(req('http://app/api/jobs'))).status, 401);
});

test('get returns 404 for a job not in this workspace', async () => {
  const handler = createJobGetHandler({
    getSession: okSession, getWorkspace: okWorkspace, pool: {},
    getJob: async () => null,
  });
  const res = await handler(req('http://app/api/jobs/j9'), { params: Promise.resolve({ id: 'j9' }) });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk node --test nexoclip-app/tests/api/jobsRoute.test.mjs`
Expected: FAIL — route modules do not exist.

- [ ] **Step 3: Write the list route**

```js
// nexoclip-app/app/api/jobs/route.js
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../src/lib/auth/session.js';
import { getCurrentSession } from '../../../src/services/authService.js';
import { getDefaultWorkspace } from '../../../src/services/workspaceService.js';
import { getPool } from '../../../src/db/pool.js';
import { listJobs as listJobsService } from '../../../src/services/jobService.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function createJobsListHandler({
  getSession = getCurrentSession, getWorkspace = getDefaultWorkspace,
  listJobs = listJobsService, pool = getPool(),
} = {}) {
  return async function GET(request) {
    const session = await getSession(request.cookies?.get(SESSION_COOKIE)?.value);
    if (!session?.user_id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const workspace = await getWorkspace(session.user_id);
    if (!workspace?.id) return NextResponse.json({ error: 'No workspace is available' }, { status: 403 });

    const url = new URL(request.url);
    const statuses = url.searchParams.get('status') === 'active' ? ['queued', 'running'] : null;
    const { jobs } = await listJobs({ pool, workspaceId: workspace.id, statuses });
    return NextResponse.json({ jobs });
  };
}

export const GET = createJobsListHandler();
```

- [ ] **Step 4: Write the single-job route**

```js
// nexoclip-app/app/api/jobs/[id]/route.js
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { getCurrentSession } from '../../../../src/services/authService.js';
import { getDefaultWorkspace } from '../../../../src/services/workspaceService.js';
import { getPool } from '../../../../src/db/pool.js';
import { getJob as getJobService } from '../../../../src/services/jobService.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function createJobGetHandler({
  getSession = getCurrentSession, getWorkspace = getDefaultWorkspace,
  getJob = getJobService, pool = getPool(),
} = {}) {
  return async function GET(request, { params }) {
    const session = await getSession(request.cookies?.get(SESSION_COOKIE)?.value);
    if (!session?.user_id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const workspace = await getWorkspace(session.user_id);
    if (!workspace?.id) return NextResponse.json({ error: 'No workspace is available' }, { status: 403 });

    const { id } = await params;
    const job = await getJob({ pool, workspaceId: workspace.id, id });
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    return NextResponse.json({ job });
  };
}

export const GET = createJobGetHandler();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `rtk node --test nexoclip-app/tests/api/jobsRoute.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
rtk git add nexoclip-app/app/api/jobs/route.js "nexoclip-app/app/api/jobs/[id]/route.js" nexoclip-app/tests/api/jobsRoute.test.mjs
rtk git commit -m "feat: expose the global job list and single-job routes"
```

---

## Task 4: Refresh-safe shared client (`durableJobStore`)

**Files:**
- Create: `nexoclip-app/src/lib/jobs/durableJobStore.js`
- Test: `nexoclip-app/tests/jobs/durableJobStore.test.mjs`

**Interfaces:**
- Consumes: a storage backend with `getItem(key)`/`setItem(key, value)` (Web Storage) OR a `Map` (tests). Nothing else.
- Produces:
  - `rememberActiveJob(workspaceId, jobId, storage)` — persist an active job id.
  - `forgetActiveJob(workspaceId, jobId, storage)` — drop it (on completion).
  - `restoreActiveJobs(workspaceId, storage) → string[]` — ids to reattach on load; `[]` on missing/malformed data.
- Storage key: `nexoclip-active-jobs`. Value: JSON `{ [workspaceId]: string[] }`.

- [ ] **Step 1: Write the failing test**

```js
// nexoclip-app/tests/jobs/durableJobStore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberActiveJob, forgetActiveJob, restoreActiveJobs } from '../../src/lib/jobs/durableJobStore.js';

function mapStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

test('remembers and restores active jobs per workspace', () => {
  const s = mapStorage();
  rememberActiveJob('ws-1', 'j1', s);
  rememberActiveJob('ws-1', 'j2', s);
  rememberActiveJob('ws-2', 'j9', s);
  assert.deepEqual(restoreActiveJobs('ws-1', s).sort(), ['j1', 'j2']);
  assert.deepEqual(restoreActiveJobs('ws-2', s), ['j9']);
});

test('forgetActiveJob drops only that id', () => {
  const s = mapStorage();
  rememberActiveJob('ws-1', 'j1', s);
  rememberActiveJob('ws-1', 'j2', s);
  forgetActiveJob('ws-1', 'j1', s);
  assert.deepEqual(restoreActiveJobs('ws-1', s), ['j2']);
});

test('restore tolerates missing and malformed storage', () => {
  assert.deepEqual(restoreActiveJobs('ws-1', mapStorage()), []);
  assert.deepEqual(restoreActiveJobs('ws-1', mapStorage({ 'nexoclip-active-jobs': '{bad json' })), []);
  assert.deepEqual(restoreActiveJobs('ws-1', mapStorage({ 'nexoclip-active-jobs': '5' })), []);
});

test('remembering the same id twice does not duplicate it', () => {
  const s = mapStorage();
  rememberActiveJob('ws-1', 'j1', s);
  rememberActiveJob('ws-1', 'j1', s);
  assert.deepEqual(restoreActiveJobs('ws-1', s), ['j1']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk node --test nexoclip-app/tests/jobs/durableJobStore.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the store**

```js
// nexoclip-app/src/lib/jobs/durableJobStore.js
// Pure, DOM-free. Persists which jobs to reattach to after a refresh; the server
// remains the source of truth for a job's actual status/result.
const KEY = 'nexoclip-active-jobs';

function read(storage) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function write(storage, data) {
  try {
    storage?.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — best effort */
  }
}

export function rememberActiveJob(workspaceId, jobId, storage) {
  const data = read(storage);
  const list = Array.isArray(data[workspaceId]) ? data[workspaceId] : [];
  if (!list.includes(jobId)) list.push(jobId);
  data[workspaceId] = list;
  write(storage, data);
}

export function forgetActiveJob(workspaceId, jobId, storage) {
  const data = read(storage);
  const list = Array.isArray(data[workspaceId]) ? data[workspaceId] : [];
  data[workspaceId] = list.filter((id) => id !== jobId);
  write(storage, data);
}

export function restoreActiveJobs(workspaceId, storage) {
  const list = read(storage)[workspaceId];
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk node --test nexoclip-app/tests/jobs/durableJobStore.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
rtk git add nexoclip-app/src/lib/jobs/durableJobStore.js nexoclip-app/tests/jobs/durableJobStore.test.mjs
rtk git commit -m "feat: add refresh-safe durable job store helper"
```

---

## Task 5: Global job list UI (header panel)

**Files:**
- Create: `nexoclip-app/src/lib/jobs/jobDisplay.js` (pure display shaping)
- Create: `nexoclip-app/components/JobListPanel.js`
- Modify: `nexoclip-app/components/StandaloneShell.js` (mount the panel in the header)
- Test: `nexoclip-app/tests/jobs/jobDisplay.test.mjs`

**Interfaces:**
- Consumes: a job `{ id, kind, status, result }` where `result` may hold the display contract `{ kind, title, thumbnailUrl?, outputUrl?, outputText? }`.
- Produces: `toJobListItem(job) → { id, kind, title, status, outputUrl, thumbnailUrl }` — the pure shaper the panel renders. `JobListPanel` polls `GET /api/jobs?status=active` and renders `toJobListItem` rows.

- [ ] **Step 1: Write the failing test**

```js
// nexoclip-app/tests/jobs/jobDisplay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { toJobListItem } from '../../src/lib/jobs/jobDisplay.js';

test('uses the result display contract when present', () => {
  const item = toJobListItem({
    id: 'j1', kind: 'video', status: 'succeeded',
    result: { kind: 'video', title: 'Beach render', outputUrl: 'https://x/y.mp4', thumbnailUrl: 'https://x/t.png' },
  });
  assert.deepEqual(item, {
    id: 'j1', kind: 'video', title: 'Beach render', status: 'succeeded',
    outputUrl: 'https://x/y.mp4', thumbnailUrl: 'https://x/t.png',
  });
});

test('falls back to a kind-based title when result is missing', () => {
  const item = toJobListItem({ id: 'j2', kind: 'image', status: 'running', result: null });
  assert.equal(item.title, 'Image generation');
  assert.equal(item.status, 'running');
  assert.equal(item.outputUrl, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk node --test nexoclip-app/tests/jobs/jobDisplay.test.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the display shaper**

```js
// nexoclip-app/src/lib/jobs/jobDisplay.js
const KIND_TITLES = {
  image: 'Image generation',
  video: 'Video generation',
  clipping: 'AI clipping',
  audio: 'Audio generation',
  workflow_node: 'Workflow node',
  vimax_render_video: 'Storyboard render',
  vimax_narrative_planning: 'Storyboard planning',
  vimax_novel_planning: 'Storyboard planning',
};

export function toJobListItem(job) {
  const r = job.result && typeof job.result === 'object' ? job.result : null;
  return {
    id: job.id,
    kind: job.kind,
    title: (r && r.title) || KIND_TITLES[job.kind] || 'Job',
    status: job.status,
    outputUrl: (r && r.outputUrl) || null,
    thumbnailUrl: (r && r.thumbnailUrl) || null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk node --test nexoclip-app/tests/jobs/jobDisplay.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the panel component**

```js
// nexoclip-app/components/JobListPanel.js
'use client';

import { useEffect, useState } from 'react';
import { toJobListItem } from '../src/lib/jobs/jobDisplay.js';

// Header panel: polls active jobs while any are running, shows recent on open.
export default function JobListPanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function poll(query) {
      try {
        const res = await fetch(`/api/jobs${query}`, { credentials: 'include' });
        if (!res.ok) return;
        const { jobs } = await res.json();
        if (!cancelled) setItems((jobs || []).map(toJobListItem));
      } catch { /* transient — keep last state */ }
    }
    // When open, show recent (all). Otherwise track only active jobs.
    poll(open ? '' : '?status=active');
    const timer = window.setInterval(() => poll(open ? '' : '?status=active'), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open]);

  const activeCount = items.filter((i) => i.status === 'queued' || i.status === 'running').length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:text-white"
        title="Jobs"
        aria-label="Jobs"
      >
        <span aria-hidden>▤</span>
        {activeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-[#22d3ee] px-1 text-[10px] font-bold text-black">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-auto rounded-xl border border-white/10 bg-[#0d0d0f] p-2 shadow-2xl">
          {items.length === 0 ? (
            <p className="px-2 py-3 text-xs text-white/40">No jobs yet.</p>
          ) : (
            items.map((it) => (
              <div key={it.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                {it.thumbnailUrl ? (
                  <img src={it.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded bg-white/5 text-[10px] text-white/40">
                    {it.kind.slice(0, 3)}
                  </span>
                )}
                <span className="flex-1 truncate text-xs text-white/80">{it.title}</span>
                <span className="text-[10px] uppercase text-white/40">{it.status}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Mount the panel in the header**

In `nexoclip-app/components/StandaloneShell.js`, import and render `<JobListPanel />` in the top header row, next to the existing account/notification controls. Add:

```js
import JobListPanel from './JobListPanel.js';
```

and place `<JobListPanel />` inside the header's right-hand control cluster (near where notifications/account already render). Keep the change to a single added element; do not restructure the header.

- [ ] **Step 7: Verify the build**

Run: `rtk npm --prefix nexoclip-app run build`
Expected: build succeeds; `/api/jobs` and `/api/jobs/[id]` appear in the route list.

- [ ] **Step 8: Commit**

```bash
rtk git add nexoclip-app/src/lib/jobs/jobDisplay.js nexoclip-app/components/JobListPanel.js nexoclip-app/components/StandaloneShell.js nexoclip-app/tests/jobs/jobDisplay.test.mjs
rtk git commit -m "feat: add global job list panel to the header"
```

---

## Task 6: Video reference migration (durable `video` job)

**Files:**
- Modify: `nexoclip-app/app/api/openrouter/videos/route.js`
- Modify: `nexoclip-app/app/api/openrouter/videos/[id]/route.js`
- Test: `nexoclip-app/tests/api/videoJobMigration.test.mjs`

**Interfaces:**
- Consumes: `jobService.createJob`, `jobService.updateJobStatus`; the existing `createOpenRouterVideoAdapter`.
- Produces: `POST /api/openrouter/videos` returns `{ id, job_id, status, polling_url }` where `job_id` is a durable `video` job id. On completion the job `result` holds `{ kind: 'video', title, outputUrl }`.

- [ ] **Step 1: Write the failing test**

```js
// nexoclip-app/tests/api/videoJobMigration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoSubmitHandler } from '../../app/api/openrouter/videos/route.js';

function postReq(body) {
  const r = new Request('http://app/api/openrouter/videos', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'ws-1' },
    body: JSON.stringify(body),
  });
  r.cookies = { get: (n) => (n === 'nexoclip_session' ? { value: 'tok' } : undefined) };
  return r;
}

test('submitting a video creates a durable video job and returns its id', async () => {
  let created;
  const handler = createVideoSubmitHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }),
    env: { OPENROUTER_API_KEY: 'k' },
    submitVideo: async () => ({ id: 'or-1', polling_url: 'p', status: 'pending' }),
    createJob: async ({ workspaceId, kind }) => {
      created = { workspaceId, kind };
      return { id: 'job-1', status: 'queued' };
    },
  });
  const res = await handler(postReq({ model: 'google/veo-3.1', prompt: 'a cat' }));
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.job_id, 'job-1');
  assert.deepEqual(created, { workspaceId: 'ws-1', kind: 'video' });
});

test('missing model/prompt is 400 before any job is created', async () => {
  let calls = 0;
  const handler = createVideoSubmitHandler({
    resolveTenant: async () => ({ workspace: { id: 'ws-1' } }),
    env: { OPENROUTER_API_KEY: 'k' },
    submitVideo: async () => ({ id: 'x' }),
    createJob: async () => { calls += 1; return { id: 'j' }; },
  });
  const res = await handler(postReq({ prompt: 'no model' }));
  assert.equal(res.status, 400);
  assert.equal(calls, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk node --test nexoclip-app/tests/api/videoJobMigration.test.mjs`
Expected: FAIL — `createVideoSubmitHandler` is not exported.

- [ ] **Step 3: Refactor the video submit route into an injectable handler**

Rewrite `nexoclip-app/app/api/openrouter/videos/route.js` to export a `createVideoSubmitHandler({ resolveTenant, env, submitVideo, createJob })` factory (defaults wired to the real `resolveTenantContext`, `process.env`, `createOpenRouterVideoAdapter(...).submit`, and `jobService.createJob`). The handler:
1. Validates `env.OPENROUTER_API_KEY` (503 if absent) and body `{ model, prompt }` (400 if absent) BEFORE creating a job.
2. Resolves the tenant from the session cookie + `x-workspace-id`.
3. Calls `submitVideo(...)` → `{ id: providerId, polling_url }`.
4. `createJob({ pool, workspaceId, kind: 'video', params: { providerId, model, prompt } })`.
5. Returns `202` `{ id: providerId, job_id: job.id, status: 'queued', polling_url }`.

Keep `export const POST = createVideoSubmitHandler();` at the bottom.

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk node --test nexoclip-app/tests/api/videoJobMigration.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the completion contract into the job on poll**

In `nexoclip-app/app/api/openrouter/videos/[id]/route.js`, when the video completes and the R2 URL is produced, call
`updateJobStatus({ pool, workspaceId, id: jobId, status: 'succeeded', result: { kind: 'video', title: 'Video generation', outputUrl } })`
(the `jobId` travels via the client, which now holds `job_id`; accept it as a query param `?job_id=`). On failure, `updateJobStatus(..., status: 'failed', error: { message })`. Guard so a job-update failure does not break the existing poll response.

- [ ] **Step 6: Wire Video Studio to the durable job + global list**

In `nexoclip-app/packages/studio/src/muapi.js` `generateVideoOpenRouter`, after submit capture `job_id` from the response and, in the browser, `rememberActiveJob(workspaceId, job_id, window.localStorage)` on submit and `forgetActiveJob(...)` on terminal status, importing from `../../../../src/lib/jobs/durableJobStore.js`. (If a cross-package import is awkward, inline the same three-function helper in the studio package — behavior must match the tested `durableJobStore`.) This makes an in-flight video reattach after refresh and appear in the header panel.

- [ ] **Step 7: Verify build + full focused suite**

```bash
rtk node --test nexoclip-app/tests/api/jobsRoute.test.mjs nexoclip-app/tests/jobs/jobService.test.mjs nexoclip-app/tests/jobs/durableJobStore.test.mjs nexoclip-app/tests/jobs/jobDisplay.test.mjs nexoclip-app/tests/api/videoJobMigration.test.mjs nexoclip-app/tests/db/unifiedJobsMigration.test.mjs
rtk npm --prefix nexoclip-app run build:studio
rtk npm --prefix nexoclip-app run build
```
Expected: all tests pass; both builds succeed.

- [ ] **Step 8: Commit**

```bash
rtk git add nexoclip-app/app/api/openrouter/videos/route.js "nexoclip-app/app/api/openrouter/videos/[id]/route.js" nexoclip-app/packages/studio/src/muapi.js nexoclip-app/tests/api/videoJobMigration.test.mjs
rtk git commit -m "feat: make video generation a durable, refresh-safe, listed job"
```

---

## Plan Self-Review

- **Coverage:** Task 1 = unified job store migration (spec §1); Task 2 = generic job service (spec §2); Task 3 = global routes (spec §3); Task 4 = refresh-safe client (spec §5); Task 5 = header job list UI (spec §4); Task 6 = video reference migration (spec §6). All Plan-1 spec components are covered.
- **Non-goals respected:** image/clipping/audio/workflow migration and localStorage retirement are left to Plan 2; no websockets; no cancel/retry UI.
- **Type consistency:** `createJob/getJob/listJobs/updateJobStatus` signatures and the `{ id, kind, status, params, result, error, createdAt, updatedAt }` job shape are identical across Tasks 2, 3, and 6. The display contract `{ kind, title, thumbnailUrl?, outputUrl?, outputText? }` is produced in Task 6 and consumed in Task 5's `toJobListItem`. The `durableJobStore` API (`rememberActiveJob`/`forgetActiveJob`/`restoreActiveJobs`) defined in Task 4 is consumed in Task 6.
- **Workspace isolation:** every read/list route resolves the workspace server-side and scopes SQL by `workspace_id`; Task 2 and Task 3 tests assert cross-workspace reads fail.
