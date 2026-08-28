# Micro-Drama Generator: Backend Service Adaptation (Sub-project 1 of 4)

Date: 2026-08-28
Related: `nexoclip-app/services/Open-AI-Micro-Drama-Generator/` (standalone
cloned repo being integrated), `nexoclip-app/services/ai-clip/api.py`
(reference pattern this design mirrors)

## Why

`services/Open-AI-Micro-Drama-Generator` is a standalone open-source app
(its own Next.js client + FastAPI server) dropped into `nexoclip-app`.
Integrating it fully into nexoclip-app is a 4-part effort:

1. **Backend service adaptation** (this spec) — turn the FastAPI server
   into an internal, token-authenticated service nexoclip-app can call,
   matching the pattern `services/ai-clip` already established.
2. Provider routing — the pipeline's image/video generation calls go
   through nexoclip's own `/api/openrouter/images` / `/api/openrouter/videos`
   (which already have direct-provider fallback) instead of calling
   `api.muapi.ai` directly.
3. Next.js proxy + durable job integration — new `/api/micro-drama/*`
   routes that resolve tenant/workspace, forward to this service, and
   record job state via `src/services/jobService.js`.
4. Studio UI — port `client/`'s `IdeaForm`/`PipelineProgress`/`VideoResult`
   into a new `packages/studio` component, wired into
   `components/StandaloneShell.js`'s nav (`TABS`/`NAVIGATION_CATEGORIES`).

This spec covers **only sub-project 1**. Sub-projects 2-4 are separate,
later brainstorm → spec → plan cycles.

## Reference pattern (`services/ai-clip/api.py`)

`ai-clip` is a private FastAPI wrapper, callable only by nexoclip-app's
server-side proxy, never directly by the browser:

```python
def require_runtime_token(
    x_nexoclip_runtime_token: str | None = Header(default=None),
) -> None:
    expected = os.environ.get("AI_CLIP_RUNTIME_TOKEN", "")
    if not expected or not x_nexoclip_runtime_token or not compare_digest(x_nexoclip_runtime_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

@app.post("/internal/v1/clip-jobs", status_code=status.HTTP_202_ACCEPTED)
async def create_clip_job(req: ClipRequest, _: None = Depends(require_runtime_token)) -> dict[str, str]: ...

@app.get("/internal/v1/clip-jobs/{job_id}")
async def get_clip_job(job_id: str, _: None = Depends(require_runtime_token)) -> dict[str, Any]: ...
```

Final output is uploaded to Cloudflare R2 (`r2_upload.py`, same bucket the
Node app uses) rather than served from local disk:

```python
def upload_file_to_r2(local_path: str, key: str, content_type: str) -> str:
    bucket = os.environ["R2_BUCKET"]
    public_url = os.environ["R2_PUBLIC_URL"].rstrip("/")
    _client().upload_file(local_path, bucket, key, ExtraArgs={"ContentType": content_type})
    return f"{public_url}/{key}"
```

The Next.js side runs the service as a plain background process
(`package.json`): `"dev:ai-clip": "cd services/ai-clip && ... uvicorn api:app --host 127.0.0.1 --port 4175"`.

## Design

**1. Auth.** Add `require_runtime_token` to `server/api.py`, identical to
`ai-clip`'s, checking header `X-NexoClip-Runtime-Token` against env
`MICRODRAMA_RUNTIME_TOKEN`.

**2. Endpoints — replace the public API surface with an internal one.**
The current public endpoints (`POST /api/generate`, `GET /api/status/{job_id}`
SSE, `GET /api/result/{job_id}`) are **removed**, not kept in parallel —
the standalone `client/` this API currently serves is being replaced by
the nexoclip Studio UI in sub-project 4, so there is no consumer left for
the public surface once this lands. New surface, all under
`Depends(require_runtime_token)` except health:

- `GET /api/health` — unchanged, stays public (matches `ai-clip`'s public
  `/healthz`).
- `POST /internal/v1/microdrama-jobs` — body `{idea, user_requirement,
  style, mode, script, workspace_id}` (same fields as today's
  `GenerateRequest` plus `workspace_id`, accepted now for forward
  compatibility with sub-project 3's tenant-aware proxy, not used for
  anything in this sub-project). Starts the pipeline as a background task
  exactly as today's `run_pipeline` does. Returns `{"id": job_id, "status":
  "running"}`, HTTP 202.
- `GET /internal/v1/microdrama-jobs/{job_id}/stream` — SSE. Same
  `event_generator` logic as today's `/api/status/{job_id}` (replay
  buffered events, then stream live from the queue) — kept as SSE per
  explicit decision (not converted to polling like `ai-clip`), because the
  pipeline reports many discrete progress stages and the existing UI code
  being ported in sub-project 4 already consumes an event stream.
- `GET /internal/v1/microdrama-jobs/{job_id}` — snapshot status (same
  shape as today's `/api/result/{job_id}`: `{job_id, status, video_url,
  error}`). Exists for reattach if the SSE connection drops or the caller
  reconnects later — sub-project 3's Next.js proxy will use this for its
  durable job record, independent of whether the browser is still
  SSE-connected.

**3. Output storage.** Replace the `app.mount("/outputs", StaticFiles(...))`
local-serving setup with an R2 upload, mirroring `ai-clip/r2_upload.py`
exactly (same env vars: `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL` — same bucket the Node app and
`ai-clip` already use). In `run_pipeline`, after the pipeline produces a
local `video_path`, upload it to R2 under a key namespaced by job id (e.g.
`microdrama/{job_id}/final.mp4`) and set `job["video_url"]` to the returned
public R2 URL instead of the local `/outputs/...` relative path. Copy
`r2_upload.py` into this service's `server/` directory (small, dependency-free
file — duplicating it here avoids a cross-service Python import, matching
how each service in `services/` is already independently deployable).

**4. Error handling.**
- Missing/invalid runtime token → 401, handled by the `Depends`, same as
  `ai-clip`.
- Unknown `job_id` on either GET endpoint → 404 (unchanged from today).
- Pipeline exception → job status `"failed"`, `error` message captured
  (unchanged from today's `except Exception as exc` block in
  `run_pipeline`).
- **New failure mode**: R2 upload failure. Wrap the upload call in the same
  `try/except` that already surrounds pipeline execution in `run_pipeline`,
  so an upload failure produces a `"failed"` job with a clear error message
  (e.g. `"Video generated but upload to storage failed: {exc}"`) rather than
  a silent crash or a job stuck `"running"` forever.

**5. Service startup.** Add to `nexoclip-app/package.json`:
```json
"dev:micro-drama": "cd services/Open-AI-Micro-Drama-Generator/server && set -a && . ../../../.env.local && set +a && .venv/bin/uvicorn api:app --host 127.0.0.1 --port 4176",
```
(port 4176 — next free port after `vimax` 4174 and `ai-clip` 4175). Update
`server/.env.example` to document `MICRODRAMA_RUNTIME_TOKEN` and the R2
vars (referencing the shared ones, not redefining them).

## Testing

No existing automated tests in either `ai-clip` or this service. Since this
is new code being written now, add real tests using FastAPI's bundled
`fastapi.testclient.TestClient` (no new dependency — already transitively
installed with `fastapi`) in a new `server/tests/test_internal_api.py`:

1. Request to any internal endpoint without the token header → 401.
2. Request with the wrong token → 401.
3. `POST /internal/v1/microdrama-jobs` with the correct token and a
   pipeline mocked to a no-op → 202, returns a job id, and the job becomes
   queryable via `GET /internal/v1/microdrama-jobs/{job_id}`.
4. `GET /internal/v1/microdrama-jobs/{job_id}` for an unknown id → 404.
5. R2 upload failure (mocked to raise) surfaces as job status `"failed"`
   with the upload-failure error message, not an unhandled exception.

The pipeline itself (`Idea2VideoPipeline`, `Script2VideoPipeline`) and real
MuAPI/R2 calls are mocked in these tests — this spec is about the HTTP
surface and job lifecycle, not the generation pipeline's own correctness
(unchanged by this work).

## Out of scope (tracked as sub-projects 2-4)

- Routing image/video generation through nexoclip's OpenRouter proxy
  instead of calling `api.muapi.ai` directly (sub-project 2).
- The Next.js `/api/micro-drama/*` proxy routes and `jobService.js`
  integration (sub-project 3).
- Any UI work — the Studio component and nav wiring (sub-project 4).
- Multi-tenant API key resolution (BYOK) — `workspace_id` is accepted and
  stored on the job in this sub-project, but the pipeline still reads a
  single global `MUAPI_KEY`/provider credentials from the service's own
  environment, same as today.
