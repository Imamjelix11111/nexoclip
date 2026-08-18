# Durable ViMax FastAPI Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the interactive Node-to-Python ViMax render bridge with a private Python FastAPI runtime invoked by the existing PostgreSQL-backed generation queue and a BullMQ worker, so render jobs survive browser refresh and can be recovered safely.

**Architecture:** Keep the existing `generation_jobs` table and credit-reservation transaction as the durable source of truth. Add a BullMQ adapter around the existing queue publisher/worker contracts; the worker claims jobs atomically and calls a private Python FastAPI runtime using a trusted, signed service request. The FastAPI runtime calls `ViMaxAdapters` directly rather than the CLI stdin REPL, reports structured progress to the worker, and leaves tenant workspace files as temporary artifact storage.

**Tech Stack:** Next.js 15 route handlers, Node.js ESM, raw PostgreSQL via `pg`, Redis 7, BullMQ, Python 3.13, FastAPI/Uvicorn, Docker Compose, pytest, `node:test`.

## Global Constraints

- Preserve all existing unrelated dirty files, especially auth, credits, and Storyboard UI work.
- Use the existing PostgreSQL database and `generation_jobs`; do not introduce a second physical generation database or duplicate jobs table.
- Redis/BullMQ is queue transport only; PostgreSQL remains the source of truth for job, progress, artifact, provider, and credit state.
- Runtime endpoints are Docker-private and authenticate a worker service token; browser code never calls them.
- The runtime receives trusted, structured commands; it must not accept a client-supplied filesystem root or execute the CLI stdin REPL.
- One active ViMax write/render job per workspace/session is required until ViMax workspace mutation is redesigned.
- Existing external queue adapter contracts must remain usable while BullMQ is introduced.
- Use TDD: each behavior test must fail for the missing behavior before its implementation is written.
- Do not claim completion until migrations, relevant Node/Python tests, Compose config, and a diff review have passed.

---

## File Structure

| File | Responsibility |
|---|---|
| `nexoclip-app/src/db/migrations/017_generation_vimax_runtime.sql` | Add provider submission, runtime progress, and session metadata required to recover ViMax jobs. |
| `nexoclip-app/src/repositories/generationStateRepository.js` | Persist worker-safe progress and retry publication reset. |
| `nexoclip-app/src/queue/generationQueue.js` | Publish due retries and jobs whose previous delivery was lost. |
| `nexoclip-app/src/queue/bullmqGenerationQueue.js` | BullMQ implementation of `enqueue`/`dequeue` used by existing publisher/worker interfaces. |
| `nexoclip-app/src/queue/storyboardRuntimeClient.js` | Service-token HTTP client for the Python runtime. |
| `nexoclip-app/src/queue/storyboardWorker.mjs` | Production BullMQ worker process wiring pool, queue, handler, recovery, and graceful shutdown. |
| `nexoclip-app/services/vimax/runtime_api/app.py` | FastAPI app exposing health and authenticated execute endpoints. |
| `nexoclip-app/services/vimax/runtime_api/executor.py` | Direct deterministic dispatch to `ViMaxAdapters` and workspace-scoped locking. |
| `nexoclip-app/services/vimax/Dockerfile` | Runtime-only FastAPI image; remove Node bridge dependencies and command. |
| `nexoclip-app/services/vimax/pyproject.toml` / `uv.lock` | Reproducible FastAPI/Uvicorn dependencies. |
| `docker-compose.yml` | Redis persistence, private networks, FastAPI service, BullMQ worker, health/dependency wiring. |
| `nexoclip-app/package.json` / lockfile | BullMQ dependency and worker scripts. |
| `nexoclip-app/tests/...` | Node unit/schema tests for queue, state, client, worker. |
| `nexoclip-app/services/vimax/tests/test_runtime_api.py` | FastAPI auth, validation, dispatch, and workspace-lock tests. |

### Task 1: Define durable ViMax job persistence and correct retry publication

**Files:**
- Create: `nexoclip-app/src/db/migrations/017_generation_vimax_runtime.sql`
- Modify: `nexoclip-app/src/repositories/generationStateRepository.js`
- Modify: `nexoclip-app/src/queue/generationQueue.js`
- Test: `nexoclip-app/tests/db/generationVimaxRuntimeMigration.test.mjs`
- Test: `nexoclip-app/tests/queue/generationStateRepository.test.mjs`
- Test: `nexoclip-app/tests/queue/queuePublisher.test.mjs`

**Interfaces:**
- Consumes: existing `generation_jobs` status, `attempt_count`, `next_attempt_at`, `queue_published_at`, and workspace-scoped state transitions.
- Produces: `recordGenerationProgress(pool, input)`, a retry record that can be republished, and job columns `vimax_session_id`, `provider`, `provider_request_id`, `progress`.

- [ ] **Step 1: Write the failing migration-schema tests**

```js
test('adds ViMax provider submission and progress fields to generation jobs', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS vimax_session_id TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS provider_request_id TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS progress JSONB/);
  assert.match(sql, /generation_jobs_provider_request_idx/);
});
```

- [ ] **Step 2: Run the migration-schema test and verify it fails**

Run: `cd nexoclip-app && node --test tests/db/generationVimaxRuntimeMigration.test.mjs`

Expected: FAIL because migration `017_generation_vimax_runtime.sql` does not exist.

- [ ] **Step 3: Add the additive migration**

```sql
ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS vimax_session_id TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_request_id TEXT,
  ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS generation_jobs_provider_request_idx
  ON generation_jobs (workspace_id, provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;
```

- [ ] **Step 4: Run the migration-schema test and verify it passes**

Run: `cd nexoclip-app && node --test tests/db/generationVimaxRuntimeMigration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write failing state/retry tests**

```js
test('stores structured progress under workspace and job scope', async () => {
  const pool = poolFor();
  await recordGenerationProgress(pool, {
    workspaceId: 'w1', generationId: 'g1',
    progress: { stage: 'rendering', message: 'Frame 1' },
  });
  assert.match(pool.calls[0].text, /workspace_id = \$1/);
  assert.match(pool.calls[0].text, /progress = \$3::jsonb/);
});

test('returns a retry to queued state and clears publication fields', async () => {
  const pool = poolFor();
  await retryGenerationJob(pool, retryInput);
  assert.match(pool.calls[0].text, /queue_published_at = NULL/);
  assert.match(pool.calls[0].text, /queue_claimed_at = NULL/);
});
```

- [ ] **Step 6: Run those tests and verify they fail**

Run: `cd nexoclip-app && node --test tests/queue/generationStateRepository.test.mjs`

Expected: FAIL because `recordGenerationProgress` is not exported and retry SQL does not reset queue publication fields.

- [ ] **Step 7: Implement minimal workspace-scoped progress and retry reset**

```js
export async function recordGenerationProgress(pool, { workspaceId, generationId, progress }) {
  const result = await pool.query(
    `UPDATE generation_jobs
     SET progress = $3::jsonb, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND status IN ('running', 'processing')
     RETURNING id, workspace_id, status, progress`,
    [workspaceId, generationId, JSON.stringify(progress || {})],
  );
  return result.rows[0] || null;
}
```

Update `retryGenerationJob` to set `queue_published_at = NULL, queue_claimed_at = NULL` along with retry fields.

- [ ] **Step 8: Run state tests and verify they pass**

Run: `cd nexoclip-app && node --test tests/queue/generationStateRepository.test.mjs`

Expected: PASS.

- [ ] **Step 9: Write a failing publisher test for delayed retry eligibility**

```js
test('claims a due retry even if it was published before', async () => {
  await publisher.publishAvailable();
  assert.match(pool.calls.find((call) => /UPDATE generation_jobs/.test(call.text)).text,
    /\(next_attempt_at IS NULL OR next_attempt_at <= now\(\)\)/);
});
```

- [ ] **Step 10: Run publisher tests and verify the new test fails**

Run: `cd nexoclip-app && node --test tests/queue/queuePublisher.test.mjs`

Expected: FAIL because `claimQueued` ignores `next_attempt_at`.

- [ ] **Step 11: Update the publisher query minimally**

Require `(next_attempt_at IS NULL OR next_attempt_at <= now())` in `claimQueued`; retain `FOR UPDATE SKIP LOCKED` and `queue_published_at IS NULL`.

- [ ] **Step 12: Run queue/state/schema tests and commit**

Run: `cd nexoclip-app && node --test tests/db/generationVimaxRuntimeMigration.test.mjs tests/queue/generationStateRepository.test.mjs tests/queue/queuePublisher.test.mjs`

Expected: PASS.

Commit:
```bash
rtk git add nexoclip-app/src/db/migrations/017_generation_vimax_runtime.sql nexoclip-app/src/repositories/generationStateRepository.js nexoclip-app/src/queue/generationQueue.js nexoclip-app/tests/db/generationVimaxRuntimeMigration.test.mjs nexoclip-app/tests/queue/generationStateRepository.test.mjs nexoclip-app/tests/queue/queuePublisher.test.mjs
rtk git commit -m "feat: persist ViMax generation progress"
```

### Task 2: Add the private FastAPI runtime with direct ViMax adapter dispatch

**Files:**
- Create: `nexoclip-app/services/vimax/runtime_api/__init__.py`
- Create: `nexoclip-app/services/vimax/runtime_api/executor.py`
- Create: `nexoclip-app/services/vimax/runtime_api/app.py`
- Modify: `nexoclip-app/services/vimax/pyproject.toml`
- Modify: `nexoclip-app/services/vimax/uv.lock`
- Modify: `nexoclip-app/services/vimax/Dockerfile`
- Test: `nexoclip-app/services/vimax/tests/test_runtime_api.py`

**Interfaces:**
- Consumes: `ViMaxAdapters`, `SessionIndex`, `ToolRuntimeContext`, `VIMAX_TENANTS_ROOT`, and `VIMAX_RUNTIME_TOKEN`.
- Produces: `GET /healthz`, `POST /internal/v1/jobs/{job_id}/execute`; response `{"job_id", "ok", "result", "progress"}`.

- [ ] **Step 1: Write failing FastAPI tests for authentication and typed dispatch**

```python
from fastapi.testclient import TestClient


def test_execute_rejects_missing_service_token(monkeypatch, tmp_path):
    monkeypatch.setenv("VIMAX_RUNTIME_TOKEN", "test-token")
    client = TestClient(create_app(executor=FakeExecutor(tmp_path)))
    response = client.post("/internal/v1/jobs/job-1/execute", json=payload())
    assert response.status_code == 401


def test_execute_dispatches_render_with_worker_workspace(monkeypatch, tmp_path):
    monkeypatch.setenv("VIMAX_RUNTIME_TOKEN", "test-token")
    executor = FakeExecutor(tmp_path)
    client = TestClient(create_app(executor=executor))
    response = client.post(
        "/internal/v1/jobs/job-1/execute",
        headers={"X-NexoClip-Runtime-Token": "test-token"},
        json=payload(kind="vimax_render_video", workspace_id="workspace-1"),
    )
    assert response.status_code == 200
    assert executor.calls == [("job-1", "workspace-1", "vimax_render_video")]
```

- [ ] **Step 2: Run FastAPI tests and verify they fail**

Run: `cd nexoclip-app/services/vimax && uv run pytest tests/test_runtime_api.py -q`

Expected: FAIL because `runtime_api` and FastAPI dependency do not exist.

- [ ] **Step 3: Add FastAPI/Uvicorn dependencies and lock them**

Add:
```toml
"fastapi>=0.115,<1",
"uvicorn[standard]>=0.34,<1",
```

Run: `cd nexoclip-app/services/vimax && uv lock`

- [ ] **Step 4: Implement the minimal private API**

```python
class ExecuteRequest(BaseModel):
    workspace_id: str = Field(min_length=1, max_length=96)
    kind: Literal["vimax_narrative_planning", "vimax_novel_planning", "vimax_render_video"]
    session_id: str = Field(default="", max_length=96)
    input: dict[str, Any] = Field(default_factory=dict)

@app.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}

@app.post("/internal/v1/jobs/{job_id}/execute")
async def execute(job_id: str, request: ExecuteRequest, _: None = Depends(require_runtime_token)):
    return await executor.execute(job_id=job_id, workspace_id=request.workspace_id, kind=request.kind,
                                  session_id=request.session_id, args=request.input)
```

`RuntimeExecutor` must derive `tenant_root` as `Path(VIMAX_TENANTS_ROOT) / normalized_workspace_id`; reject traversal, acquire one `asyncio.Lock` per `{workspace_id, session_id or "workspace"}`, construct `SessionIndex` and `ViMaxAdapters`, and call the matching adapter method directly. Its progress callback appends JSON-safe events to the response only; it must never expose absolute file paths.

- [ ] **Step 5: Make the Docker image run FastAPI, not Node bridge**

Replace Node install/web dependency stages and command with:

```dockerfile
ENV VIMAX_RUNTIME_HOST=0.0.0.0 \
    VIMAX_RUNTIME_PORT=4173 \
    VIMAX_TENANTS_ROOT=/app/.tenants \
    PATH="/app/.venv/bin:${PATH}"
EXPOSE 4173
CMD ["uv", "run", "uvicorn", "runtime_api.app:app", "--host", "0.0.0.0", "--port", "4173"]
```

- [ ] **Step 6: Run runtime tests and verify they pass**

Run: `cd nexoclip-app/services/vimax && uv run pytest tests/test_runtime_api.py -q`

Expected: PASS.

- [ ] **Step 7: Run existing direct-adapter regression tests and commit**

Run: `cd nexoclip-app/services/vimax && uv run pytest tests/test_vimax_adapters.py tests/test_main_agent_cli.py tests/test_runtime_api.py -q`

Expected: PASS.

Commit:
```bash
rtk git add nexoclip-app/services/vimax/runtime_api nexoclip-app/services/vimax/pyproject.toml nexoclip-app/services/vimax/uv.lock nexoclip-app/services/vimax/Dockerfile nexoclip-app/services/vimax/tests/test_runtime_api.py
rtk git commit -m "feat: expose ViMax runtime over private FastAPI"
```

### Task 3: Add BullMQ transport and a production storyboard worker

**Files:**
- Create: `nexoclip-app/src/queue/bullmqGenerationQueue.js`
- Create: `nexoclip-app/src/queue/storyboardRuntimeClient.js`
- Create: `nexoclip-app/src/queue/storyboardWorker.mjs`
- Modify: `nexoclip-app/package.json`
- Modify: `nexoclip-app/package-lock.json`
- Test: `nexoclip-app/tests/queue/bullmqGenerationQueue.test.mjs`
- Test: `nexoclip-app/tests/queue/storyboardRuntimeClient.test.mjs`
- Test: `nexoclip-app/tests/queue/storyboardWorker.test.mjs`

**Interfaces:**
- Consumes: existing `createQueuePublisher`, `createGenerationWorker`, Redis `REDIS_URL`, `VIMAX_RUNTIME_URL`, `VIMAX_RUNTIME_TOKEN`.
- Produces: `createBullMqGenerationQueue(options)`, `createStoryboardRuntimeClient(options)`, and an executable worker process.

- [ ] **Step 1: Write failing BullMQ adapter tests**

```js
test('adds a generation message with deterministic BullMQ job id', async () => {
  const queue = createBullMqGenerationQueue({ Queue: FakeQueue, Worker: FakeWorker, connection: {} });
  await queue.enqueue({ type: 'generation', generationId: 'g1', workspaceId: 'w1' }, { idempotencyKey: 'generation:g1' });
  assert.deepEqual(FakeQueue.added[0], {
    name: 'generation', data: { type: 'generation', generationId: 'g1', workspaceId: 'w1' },
    options: { jobId: 'generation:g1', removeOnComplete: true, removeOnFail: false },
  });
});
```

- [ ] **Step 2: Run adapter tests and verify they fail**

Run: `cd nexoclip-app && node --test tests/queue/bullmqGenerationQueue.test.mjs`

Expected: FAIL because BullMQ adapter does not exist.

- [ ] **Step 3: Add BullMQ and implement the adapter**

Run: `cd nexoclip-app && npm install bullmq`

```js
export function createBullMqGenerationQueue({ Queue, Worker, connection, queueName = 'generation' }) {
  const producer = new Queue(queueName, { connection });
  return {
    async enqueue(message, { idempotencyKey }) {
      await producer.add('generation', message, {
        jobId: idempotencyKey,
        removeOnComplete: true,
        removeOnFail: false,
      });
    },
    async dequeue() { throw new Error('BullMQ uses push workers; call createWorker instead'); },
    createWorker(handler, options = {}) {
      return new Worker(queueName, async (job) => handler(job.data), { connection, ...options });
    },
    async close() { await producer.close(); },
  };
}
```

Adapt `createGenerationWorker` or introduce a narrow BullMQ process handler so it calls its existing atomic `claimGeneration`/settlement logic once per BullMQ message; do not poll Redis manually.

- [ ] **Step 4: Write failing runtime-client tests**

```js
test('posts only structured worker-owned execution data with the service token', async () => {
  const fetch = async (url, init) => { captured = { url, init }; return new Response(JSON.stringify({ ok: true, result: {} })); };
  const client = createStoryboardRuntimeClient({ baseUrl: 'http://ai-storyboard:4173', token: 'secret', fetch });
  await client.execute({ id: 'g1', workspace_id: 'w1', kind: 'vimax_render_video', parameters: { sessionId: 's1' } });
  assert.equal(captured.init.headers['X-NexoClip-Runtime-Token'], 'secret');
  assert.deepEqual(JSON.parse(captured.init.body), { workspace_id: 'w1', kind: 'vimax_render_video', session_id: 's1', input: {} });
});
```

- [ ] **Step 5: Run runtime-client test and verify it fails**

Run: `cd nexoclip-app && node --test tests/queue/storyboardRuntimeClient.test.mjs`

Expected: FAIL because runtime client does not exist.

- [ ] **Step 6: Implement minimal runtime client and worker entrypoint**

`createStoryboardRuntimeClient` must use `AbortSignal.timeout(timeoutMs)`, `Content-Type: application/json`, `X-NexoClip-Runtime-Token`, and convert non-2xx responses into safe errors without echoing the token.

`storyboardWorker.mjs` must validate required environment variables, create one Redis connection, start the BullMQ consumer with bounded `STORYBOARD_WORKER_CONCURRENCY`, call `recoverQueuedGenerations` at startup/on interval, and on `SIGTERM`/`SIGINT` pause queue consumption then close worker/queue/pool.

- [ ] **Step 7: Run Node queue tests and verify they pass**

Run: `cd nexoclip-app && node --test tests/queue/generationWorker.test.mjs tests/queue/generationWorkerState.test.mjs tests/queue/bullmqGenerationQueue.test.mjs tests/queue/storyboardRuntimeClient.test.mjs tests/queue/storyboardWorker.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add nexoclip-app/package.json nexoclip-app/package-lock.json nexoclip-app/src/queue/bullmqGenerationQueue.js nexoclip-app/src/queue/storyboardRuntimeClient.js nexoclip-app/src/queue/storyboardWorker.mjs nexoclip-app/tests/queue/bullmqGenerationQueue.test.mjs nexoclip-app/tests/queue/storyboardRuntimeClient.test.mjs nexoclip-app/tests/queue/storyboardWorker.test.mjs
rtk git commit -m "feat: run storyboard jobs through BullMQ"
```

### Task 4: Wire Docker Compose and migrate the storyboard API/UI boundary

**Files:**
- Modify: `docker-compose.yml`
- Modify: `nexoclip-app/app/api/vimax/[...path]/route.js` or current proxy route(s)
- Modify: `nexoclip-app/components/vimax/reused/ViMaxApp.tsx`
- Modify: `nexoclip-app/components/vimax/reused/*` only where required for job status display
- Test: `nexoclip-app/tests/api/vimaxStoryboardJobRoute.test.mjs`
- Test: `nexoclip-app/components/vimax/reused/ViMaxApp.test.tsx` if test tooling exists; otherwise a focused route/client unit test.

**Interfaces:**
- Consumes: authenticated workspace context, job reservation service, BullMQ publisher/recovery process, `GET /api/generations/:id` status API.
- Produces: Storyboard submit that creates a durable job and a refresh path that restores job status without `/api/agent/start`.

- [ ] **Step 1: Write a failing route/client test for refresh-safe render submission**

```js
test('creates a workspace-authorized render job instead of forwarding agent start', async () => {
  const response = await POST(requestForWorkspace('w1', {
    kind: 'vimax_render_video', sessionId: 's1', input: {}, idempotencyKey: 'request-1',
  }));
  assert.equal(response.status, 202);
  assert.equal(await response.json().then((body) => body.status), 'queued');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd nexoclip-app && node --test tests/api/vimaxStoryboardJobRoute.test.mjs`

Expected: FAIL because render submission is still owned by the bridge endpoint.

- [ ] **Step 3: Add Compose services and private configuration**

Add:

```yaml
  nexoclip-redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD}"]
    volumes: ["nexoclip-redis-data:/data"]
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" ping | grep PONG"]

  nexoclip-storyboard-worker:
    build: ./nexoclip-app
    command: ["npm", "run", "worker:storyboard"]
    environment:
      DATABASE_URL: postgres://...
      REDIS_URL: redis://:${REDIS_PASSWORD}@nexoclip-redis:6379
      VIMAX_RUNTIME_URL: http://ai-storyboard:4173
      VIMAX_RUNTIME_TOKEN: ${VIMAX_RUNTIME_TOKEN}
    depends_on:
      nexoclip-postgres: { condition: service_healthy }
      nexoclip-redis: { condition: service_healthy }
      ai-storyboard: { condition: service_healthy }
```

Make `ai-storyboard` run the FastAPI Docker image; give it `VIMAX_RUNTIME_TOKEN` and tenant volume. Do not publish Redis or `ai-storyboard` ports. Add `nexoclip-redis-data` volume. Add app/worker environment values only as server-side variables.

- [ ] **Step 4: Migrate the proxy/UI behavior minimally**

Create a dedicated authenticated Next route for structured ViMax jobs that uses the existing generation reservation/service layer. Update `ViMaxApp.tsx` so initialization reads durable session/job status and never posts `/api/agent/start` merely because the page refreshed. Keep legacy read-only artifact/session routes only until matching database-backed replacements exist; do not leave a browser-accessible render-start bridge.

- [ ] **Step 5: Run focused tests and Compose validation**

Run:
```bash
cd nexoclip-app && node --test tests/api/vimaxStoryboardJobRoute.test.mjs
cd .. && docker compose -f docker-compose.yml config
```

Expected: tests PASS; Compose config resolves with private Redis and worker services.

- [ ] **Step 6: Build and smoke test the service topology**

Run:
```bash
docker compose -f docker-compose.yml build ai-storyboard nexoclip-storyboard-worker nexoclip-app
npm --prefix nexoclip-app run db:migrate
```

Then start the stack and verify:

```bash
docker compose -f docker-compose.yml up -d nexoclip-postgres nexoclip-redis ai-storyboard nexoclip-storyboard-worker nexoclip-app
curl --fail http://localhost:3005/api/health || true
```

Use the internal Docker network to verify `http://ai-storyboard:4173/healthz` from the worker container. Never log the runtime token.

- [ ] **Step 7: Run final regression checks, review diff, document Notion, and commit**

Run:
```bash
cd nexoclip-app && node --test tests/db/generationVimaxRuntimeMigration.test.mjs tests/queue/*.test.mjs tests/api/vimaxStoryboardJobRoute.test.mjs
cd services/vimax && uv run pytest tests/test_runtime_api.py tests/test_vimax_adapters.py -q
cd ../.. && npm run build
cd .. && rtk git diff --check && rtk git diff
```

Expected: all commands pass; diff contains no secrets and preserves unrelated changes.

Update the S5 Notion task with exact files, test commands/results, Compose topology, any excluded legacy endpoints, and follow-up for object storage/session/chat migration.

Commit:
```bash
rtk git add docker-compose.yml nexoclip-app/app/api nexoclip-app/components/vimax/reused nexoclip-app/tests/api
rtk git commit -m "feat: make storyboard renders durable"
```

## Self-Review

- **Spec coverage:** Tasks cover FastAPI replacement of the Node/Python bridge, structured direct adapter execution, PostgreSQL durable state, Redis/BullMQ local Compose, distinct worker, private authentication, recovery/retry, refresh-safe UI/API behavior, and documented artifact-storage deferral.
- **Known deliberate deferrals:** object-storage migration, full chat/session/history DB migration, provider-specific external request reconciliation, cancellation propagation, and gRPC are not required for this MVP.
- **Placeholder scan:** no implementation step uses TBD/TODO or unbounded "appropriate" behavior; security, retry, and test actions are explicit.
- **Type consistency:** worker executes `generation_jobs` with `kind` values mapped to `vimax_*` adapter names; runtime request fields are `workspace_id`, `kind`, `session_id`, and `input`; `recordGenerationProgress` stays workspace/job scoped.
