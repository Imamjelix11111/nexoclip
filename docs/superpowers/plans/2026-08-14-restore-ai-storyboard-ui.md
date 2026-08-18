# Restore AI Storyboard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the familiar AI Storyboard workspace shell while keeping render execution durable, refresh-safe, and independent from the retired browser-to-legacy-agent bridge.

**Architecture:** Restore the sidebar, project list, workspace, artifact panel, and glass composer from the pre-durable `ViMaxApp` while replacing bridge-owned state with explicit authenticated APIs. A lightweight runtime session catalog provides workspace-scoped project creation/listing; durable generation status remains the authority for render lifecycle, progress, and result metadata. The browser never starts/stops an agent or calls a filesystem-root/runtime-token endpoint.

**Tech Stack:** Next.js App Router, React 19, TypeScript, FastAPI, ViMax `SessionIndex`, PostgreSQL generation jobs, BullMQ, Node test runner, pytest.

## Global Constraints

- Preserve unrelated dirty work, including all queue/recovery fencing WIP, credit/auth changes, and CSS changes not owned by this UI restoration.
- Do not use a worktree; the user explicitly declined it.
- Browser render flow is only `POST /api/vimax/jobs` plus authenticated generation status reads; never call legacy `startAgent`, `stopAgent`, `sendMessage`, uploads, or generic legacy proxy writes.
- Refreshing, creating, or selecting a project must not terminate or restart an active render.
- All workspace identity derives from authenticated server session; browser payloads never contain a workspace ID, tenant root, runtime token, or filesystem path.
- Composer appearance stays compact and translucent/glass. The textarea itself retains a minimum height of `44px`.
- Preserve durable status polling by session-local browser storage, but status/result remains server-authoritative.
- Run commands with `rtk`.

---

## File Structure

| File | Responsibility |
|---|---|
| `nexoclip-app/services/vimax/runtime_api/executor.py` | Add workspace-local session list/create adapters using `SessionIndex`; never return tenant roots or raw paths. |
| `nexoclip-app/services/vimax/runtime_api/app.py` | Expose token-authenticated internal session catalog endpoints consumed only by Next. |
| `nexoclip-app/services/vimax/tests/test_runtime_api.py` | Prove runtime session catalog isolation and response sanitization. |
| `nexoclip-app/app/api/vimax/sessions/route.js` | Extend existing authenticated creation route with workspace-scoped list handling. |
| `nexoclip-app/app/api/vimax/sessions/[sessionId]/route.js` | Provide authenticated session read if the UI needs an explicit selection validation endpoint; no delete/write bridge behavior. |
| `nexoclip-app/tests/api/vimaxSessionsRoute.test.mjs` | Verify cookies/server-derived workspace, list/create behavior, and no client-controlled root/token. |
| `nexoclip-app/components/vimax/reused/api.ts` | Add typed durable-only session catalog API functions; remove unused browser legacy-write exports/callers within this component boundary. |
| `nexoclip-app/components/vimax/reused/ViMaxApp.tsx` | Restore old workspace layout and interaction shell while dispatching only durable renders and polling durable status. |
| `nexoclip-app/components/vimax/reused/ArtifactViews.tsx` | Reuse or minimally adapt existing views to render artifacts from durable result metadata, not bridge artifact routes. |
| `nexoclip-app/components/vimax/reused/types.ts` | Add small durable session/job-result view types if existing types cannot represent the server payload. |
| `nexoclip-app/components/vimax/reused/styles.css` | Keep/restyle restored shell; preserve compact glass composer and 44px textarea. |
| `nexoclip-app/tests/components/vimaxApp.test.mjs` | Add behavior-level component test using the project’s viable rendering test setup, or extract pure state helpers into `vimaxWorkspaceState.ts` with Node tests if no React DOM harness exists. |

## Task 1: Create a durable, workspace-scoped session catalog

**Files:**
- Modify: `nexoclip-app/services/vimax/runtime_api/executor.py`
- Modify: `nexoclip-app/services/vimax/runtime_api/app.py`
- Modify: `nexoclip-app/services/vimax/tests/test_runtime_api.py`

**Interfaces:**
- Consumes: `VIMAX_TENANTS_ROOT`, authenticated `workspace_id`, `SessionIndex` rooted below the server-derived tenant directory.
- Produces: `RuntimeExecutor.create_session(workspace_id, project_name) -> dict` and `RuntimeExecutor.list_sessions(workspace_id) -> list[dict]`.
- Produces: `POST /internal/v1/sessions` and `GET /internal/v1/sessions`, both requiring `X-NexoClip-Runtime-Token`.

- [ ] **Step 1: Write the failing runtime catalog tests**

Add tests to `test_runtime_api.py` using two separate workspace IDs and a temporary tenants root:

```python
def test_list_sessions_returns_only_the_authenticated_workspace_sessions(client, runtime_token):
    create = client.post(
        "/internal/v1/sessions",
        headers={"X-NexoClip-Runtime-Token": runtime_token},
        json={"workspace_id": "workspace-a", "project_name": "Launch trailer"},
    )
    assert create.status_code == 201

    client.post(
        "/internal/v1/sessions",
        headers={"X-NexoClip-Runtime-Token": runtime_token},
        json={"workspace_id": "workspace-b", "project_name": "Private project"},
    )

    response = client.get(
        "/internal/v1/sessions?workspace_id=workspace-a",
        headers={"X-NexoClip-Runtime-Token": runtime_token},
    )
    assert response.status_code == 200
    assert [item["projectName"] for item in response.json()["sessions"]] == ["Launch trailer"]
    assert "workingDir" not in response.json()["sessions"][0]
```

Add a test that missing/invalid token receives `401` before request body/query processing, and that malformed workspace IDs are rejected.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```sh
rtk nexoclip-app/services/vimax/.venv/bin/python -m pytest nexoclip-app/services/vimax/tests/test_runtime_api.py -q
```

Expected: FAIL because `GET /internal/v1/sessions` and/or `list_sessions` is absent.

- [ ] **Step 3: Implement minimal catalog methods**

In `executor.py`, use the same server-derived tenant-root helper already used by execute/session creation. Load the workspace-local `SessionIndex`; map entries into only the UI-safe fields:

```python
{
    "sessionId": record.session_id,
    "projectName": record.project_name or "",
    "stage": record.stage or "created",
    "summary": record.summary or "",
    "updatedAt": record.updated_at,
    "createdAt": record.created_at,
}
```

Do not return `working_dir`, absolute tenant paths, provider credentials, or arbitrary session file contents. Sort newest-updated first.

In `app.py`, add an internal GET endpoint beside the existing POST session endpoint. Reuse constant-time token verification, bounded query validation, and `RuntimeExecutor` injection. It must not accept a root/path override.

- [ ] **Step 4: Run runtime catalog tests to verify GREEN**

Run:

```sh
rtk nexoclip-app/services/vimax/.venv/bin/python -m pytest nexoclip-app/services/vimax/tests/test_runtime_api.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```sh
rtk git add nexoclip-app/services/vimax/runtime_api/executor.py nexoclip-app/services/vimax/runtime_api/app.py nexoclip-app/services/vimax/tests/test_runtime_api.py
rtk git commit -m "feat: list durable storyboard sessions"
```

## Task 2: Expose authenticated Next session catalog routes

**Files:**
- Modify: `nexoclip-app/app/api/vimax/sessions/route.js`
- Create: `nexoclip-app/tests/api/vimaxSessionsRoute.test.mjs`

**Interfaces:**
- Consumes: browser session cookie, `getCurrentSession`, `getDefaultWorkspace`, `VIMAX_RUNTIME_URL`, `VIMAX_RUNTIME_TOKEN`.
- Produces: `GET /api/vimax/sessions -> {sessions: SessionSummary[]}` and existing `POST /api/vimax/sessions -> {session_id}`.

- [ ] **Step 1: Write failing route tests**

Use the existing injected-handler pattern from `vimaxStoryboardJobRoute.test.mjs`. Test GET derives the workspace from server auth and does not use any browser workspace header:

```js
test('lists durable sessions using the authenticated workspace only', async () => {
  const handler = createVimaxSessionsHandler({
    getSession: async () => ({user_id: 'user-1'}),
    getWorkspace: async () => ({id: 'workspace-server'}),
    env: {VIMAX_RUNTIME_URL: 'http://runtime', VIMAX_RUNTIME_TOKEN: 'secret'},
    fetchFn: async (url, init) => {
      assert.equal(url, 'http://runtime/internal/v1/sessions?workspace_id=workspace-server');
      assert.equal(init.headers['X-NexoClip-Runtime-Token'], 'secret');
      return Response.json({sessions: [{sessionId: 's-1', projectName: 'Trailer'}]});
    },
  });
  const response = await handler(new Request('http://app/api/vimax/sessions', {
    headers: {'x-workspace-id': 'attacker-workspace'},
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sessions[0].sessionId, 's-1');
});
```

Also test unauthenticated `401`, absent runtime configuration `503`, and POST continues to forward only server-derived workspace ID plus bounded project name.

- [ ] **Step 2: Run route tests to verify RED**

Run:

```sh
rtk node --test nexoclip-app/tests/api/vimaxSessionsRoute.test.mjs
```

Expected: FAIL because no GET handler/catalog forwarding exists.

- [ ] **Step 3: Implement the route handler**

Rename/factor the exported factory to `createVimaxSessionsHandler` and return a method-aware handler, or export separate `create...GetHandler` and `create...PostHandler` while retaining injectable dependencies. Authenticate first; resolve workspace once; construct the runtime URL using `URL`/`URLSearchParams`; forward token only server-to-server. Return generic `502` on runtime failure and never relay a runtime token/root in an error body.

- [ ] **Step 4: Run route tests to verify GREEN**

Run:

```sh
rtk node --test nexoclip-app/tests/api/vimaxSessionsRoute.test.mjs nexoclip-app/tests/api/vimaxJobStatusRoute.test.mjs nexoclip-app/tests/api/vimaxStoryboardJobRoute.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```sh
rtk git add nexoclip-app/app/api/vimax/sessions/route.js nexoclip-app/tests/api/vimaxSessionsRoute.test.mjs
rtk git commit -m "feat: expose durable storyboard sessions"
```

## Task 3: Restore the storyboard shell with durable project/render state

**Files:**
- Modify: `nexoclip-app/components/vimax/reused/ViMaxApp.tsx`
- Modify: `nexoclip-app/components/vimax/reused/api.ts`
- Modify: `nexoclip-app/components/vimax/reused/types.ts`
- Create: `nexoclip-app/components/vimax/reused/vimaxWorkspaceState.ts`
- Create: `nexoclip-app/tests/components/vimaxWorkspaceState.test.mjs`

**Interfaces:**
- Consumes: `getVimaxSessions()`, `createVimaxSession(projectName)`, `submitVimaxJob()`, and `getVimaxJob()`.
- Produces: a restored `ViMaxApp` workspace that never imports/calls legacy agent bridge functions.
- Produces: pure helpers `restoreDurableJob(sessionId, storage)` and `saveDurableJob(sessionId, job, storage)` to make refresh behavior testable without a browser DOM.

- [ ] **Step 1: Write failing pure state tests**

Create `vimaxWorkspaceState.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreDurableJob, saveDurableJob} from '../../components/vimax/reused/vimaxWorkspaceState.ts';

test('restores only the durable job belonging to the selected session', () => {
  const storage = new Map();
  saveDurableJob('session-a', {id: 'job-a', status: 'running'}, storage);
  saveDurableJob('session-b', {id: 'job-b', status: 'queued'}, storage);
  assert.deepEqual(restoreDurableJob('session-a', storage), {id: 'job-a', status: 'running'});
  assert.equal(restoreDurableJob('session-c', storage), undefined);
});

test('ignores malformed persisted durable job data', () => {
  const storage = new Map([['vimax-durable-jobs', '{bad json']]);
  assert.equal(restoreDurableJob('session-a', storage), undefined);
});
```

Adapt import/runtime mechanics to the project’s Node/TypeScript configuration; if direct TypeScript import is unsupported, make this small helper `.js` with JSDoc typedefs.

- [ ] **Step 2: Run state tests to verify RED**

Run:

```sh
rtk node --test nexoclip-app/tests/components/vimaxWorkspaceState.test.mjs
```

Expected: FAIL because the state helper does not exist.

- [ ] **Step 3: Implement durable-only API and state helpers**

In `api.ts`, add:

```ts
export async function getVimaxSessions(): Promise<{sessions: SessionSummary[]}> {
  return request('/api/vimax/sessions');
}
```

Keep `createVimaxSession`, `submitVimaxJob`, and `getVimaxJob`. Remove direct exports for legacy write calls once no restored UI caller needs them. Do not add generic bridge API functions.

Persist jobs as a single JSON map keyed by session:

```ts
type StoredJobs = Record<string, {id: string; status: string}>;
const STORAGE_KEY = 'vimax-durable-jobs';
```

The helper must tolerate unavailable storage, malformed JSON, and unexpected stored shapes.

- [ ] **Step 4: Restore the visual shell minimally and safely**

Use `b1adcfd:nexoclip-app/components/vimax/reused/ViMaxApp.tsx` as the visual reference, not as a blind replacement. Restore:

- sidebar brand, workspace/artifacts navigation, project list, responsive sidebar controls;
- empty conversation/workspace screen;
- composer shell, model-looking control presentation only if it does not invoke legacy model API, project dialog, and storyboard panel;
- project selection from `getVimaxSessions()`;
- project creation from `createVimaxSession(projectName)`;
- selected session job restoration via `restoreDurableJob` and authoritative `getVimaxJob` polling;
- a visible durable render action that invokes exactly:

```ts
submitVimaxJob({
  kind: 'vimax_render_video',
  sessionId: selectedSessionId,
  input: {},
  idempotencyKey: crypto.randomUUID(),
});
```

The action may appear as the composer primary action or a dedicated render button in the familiar composer area. It must not use arbitrary draft text as a render request. Display queued/running/succeeded/failed and persisted `progress`/`result` in the workspace/stage panel.

For chat text, uploads, model switching, delete, and stop controls: do not make hidden/failing bridge calls. Either omit each control or keep it disabled with a clear message: `Interactive chat and uploads are temporarily unavailable while durable storyboard migration is in progress.`

Do not call `startAgent`, `stopAgent`, `sendMessage`, `subscribeToEvents`, `getHistory`, `getArtifacts`, `getModelSelections`, `saveModelSelections`, `uploadWorkspaceFile`, or the generic legacy `[...path]` route.

- [ ] **Step 5: Run state/UI compilation tests to verify GREEN**

Run:

```sh
rtk node --test nexoclip-app/tests/components/vimaxWorkspaceState.test.mjs nexoclip-app/tests/api/vimaxSessionsRoute.test.mjs
rtk npm --prefix nexoclip-app run build
```

Expected: tests and Next build pass. The build validates the restored TypeScript component has no dead legacy imports or duplicate declarations.

- [ ] **Step 6: Commit Task 3**

Stage only restoration-owned hunks in `ViMaxApp.tsx` because the file currently contains unrelated WIP:

```sh
rtk git add nexoclip-app/components/vimax/reused/api.ts nexoclip-app/components/vimax/reused/types.ts nexoclip-app/components/vimax/reused/vimaxWorkspaceState.ts nexoclip-app/tests/components/vimaxWorkspaceState.test.mjs
rtk git add -p nexoclip-app/components/vimax/reused/ViMaxApp.tsx
rtk git commit -m "feat: restore durable storyboard workspace"
```

## Task 4: Connect durable result artifacts to the restored artifact surface

**Files:**
- Modify: `nexoclip-app/components/vimax/reused/ArtifactViews.tsx`
- Modify: `nexoclip-app/components/vimax/reused/ViMaxApp.tsx`
- Modify: `nexoclip-app/components/vimax/reused/types.ts`
- Test: `nexoclip-app/tests/components/vimaxWorkspaceState.test.mjs`

**Interfaces:**
- Consumes: authenticated generation status `generation.result.artifacts`, where every artifact has safe relative `path`, `kind`, and `name`.
- Produces: Artifact view based on durable job result metadata; it must not request `/api/vimax/artifacts`.

- [ ] **Step 1: Write a failing result-to-artifacts mapping test**

Add a pure mapper test:

```js
test('maps only validated durable result artifacts into the artifact panel model', () => {
  const artifacts = artifactsFromJobResult({
    artifacts: [
      {path: 'outputs/trailer.mp4', name: 'trailer.mp4', kind: 'video'},
      {path: '../secret', name: 'secret', kind: 'video'},
    ],
  });
  assert.deepEqual(artifacts, [{path: 'outputs/trailer.mp4', name: 'trailer.mp4', kind: 'video'}]);
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```sh
rtk node --test nexoclip-app/tests/components/vimaxWorkspaceState.test.mjs
```

Expected: FAIL because mapper is absent.

- [ ] **Step 3: Implement mapper and display**

Create an `artifactsFromJobResult` pure helper. Accept only non-empty relative paths that do not contain `..`, normalize `kind` to `image|video|document`, and use the provided name only after a safe fallback to basename. Render the existing artifact panel with the mapped list. If durable artifact URLs do not yet exist, show artifact names/type/status, not broken media links. Do not synthesize a legacy artifact API request.

- [ ] **Step 4: Run tests and build to verify GREEN**

Run:

```sh
rtk node --test nexoclip-app/tests/components/vimaxWorkspaceState.test.mjs
rtk npm --prefix nexoclip-app run build
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```sh
rtk git add nexoclip-app/components/vimax/reused/ArtifactViews.tsx nexoclip-app/components/vimax/reused/types.ts nexoclip-app/components/vimax/reused/vimaxWorkspaceState.ts nexoclip-app/tests/components/vimaxWorkspaceState.test.mjs
rtk git add -p nexoclip-app/components/vimax/reused/ViMaxApp.tsx
rtk git commit -m "feat: show durable storyboard artifacts"
```

## Task 5: Preserve composer visual requirements and verify the full boundary

**Files:**
- Modify: `nexoclip-app/components/vimax/reused/styles.css` only if restored markup requires narrow selectors.
- Test: existing route, state, Python runtime, and build suites.

**Interfaces:**
- Consumes: restored shell class names and existing `.composer` / `.composer textarea` styling.
- Produces: compact glass composer and 44px minimum textarea, without changing unrelated style rules.

- [ ] **Step 1: Write a failing CSS contract test or source assertion**

If there is no browser visual-test harness, add a Node source contract test that reads `styles.css` and asserts the focused invariant:

```js
test('composer remains compact glass with a taller input', () => {
  const css = readFileSync(new URL('../../components/vimax/reused/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.composer textarea\s*\{[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.composer\s*\{[\s\S]*backdrop-filter:\s*blur/);
});
```

Keep this focused on the user-visible contract rather than exact complete stylesheet text.

- [ ] **Step 2: Run test to verify RED if styles have regressed**

Run:

```sh
rtk node --test nexoclip-app/tests/components/vimaxWorkspaceState.test.mjs
```

Expected: either a deliberate RED caused by missing contract coverage, or immediate green only if implementing the test after already-existing CSS is unavoidable. In the latter case, explicitly record that CSS behavior pre-existed and do not claim a TDD red cycle for it.

- [ ] **Step 3: Make only necessary styling adjustments**

Keep:

```css
.composer textarea {
  min-height: 44px;
  padding: 4px 0;
}
```

Keep the translucent `background`, subtle border, and `backdrop-filter` on `.composer`. Do not restyle the full application or overwrite the user’s existing dirty CSS hunk. Add selectors only for restored durable status/disabled-capability messaging where the shell needs them.

- [ ] **Step 4: Run full focused verification**

Run:

```sh
rtk node --test nexoclip-app/tests/api/vimaxSessionsRoute.test.mjs nexoclip-app/tests/api/vimaxJobStatusRoute.test.mjs nexoclip-app/tests/api/vimaxStoryboardJobRoute.test.mjs nexoclip-app/tests/components/vimaxWorkspaceState.test.mjs
rtk nexoclip-app/services/vimax/.venv/bin/python -m pytest nexoclip-app/services/vimax/tests/test_runtime_api.py -q
rtk npm --prefix nexoclip-app run build
rtk git diff --check
```

Expected: all commands exit 0. Record any pre-existing optional BullMQ/Valkey warning separately; do not characterize it as a pass without command evidence.

- [ ] **Step 5: Commit Task 5 and update SDD evidence**

```sh
rtk git add -p nexoclip-app/components/vimax/reused/styles.css
rtk git add nexoclip-app/tests/components/vimaxWorkspaceState.test.mjs
rtk git commit -m "style: preserve storyboard glass composer"
```

Append exact command output summary, staged files, and remaining non-goals (chat turn persistence, uploads, object-storage URLs) to `.superpowers/sdd/2026-08-14-durable-vimax-fastapi-runtime/task-4-report.md` without staging unrelated plan/WIP files.

## Plan Self-Review

- **Coverage:** Task 1 creates a genuine session backing service; Task 2 authenticates it through Next; Task 3 restores the visual shell and durable interaction; Task 4 prevents artifact-view calls to the unavailable legacy runtime; Task 5 protects visual requirements and verifies the integrated boundary.
- **No legacy restart:** Tasks 2–4 explicitly omit all browser bridge write/control functions and use only durable APIs.
- **No ambiguous workspace trust:** Tasks 1–2 use workspace only after server authentication and do not accept browser root/tenant identifiers.
- **Scope:** Chat persistence, uploads, deletion, model configuration, and object-storage artifact URLs are deliberately retained as explicit future migration work, rather than reintroduced through blocked legacy APIs.
- **Type consistency:** `SessionSummary` continues to use `sessionId`; runtime session responses use this same JSON casing; durable jobs use existing `{id, status, progress, result}` shape.
