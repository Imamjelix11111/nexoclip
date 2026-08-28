# Micro-Drama Generator Backend Service Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `services/Open-AI-Micro-Drama-Generator/server`'s FastAPI app from a public, locally-serving API into an internal, token-authenticated service matching the pattern `services/ai-clip` already uses, with generated video output uploaded to R2 instead of served from local disk.

**Architecture:** `server/api.py`'s public endpoints (`POST /api/generate`, `GET /api/status/{job_id}` SSE, `GET /api/result/{job_id}`) are replaced by an internal, `X-NexoClip-Runtime-Token`-gated surface (`POST /internal/v1/microdrama-jobs`, `GET /internal/v1/microdrama-jobs/{job_id}/stream`, `GET /internal/v1/microdrama-jobs/{job_id}`) — identical auth pattern to `services/ai-clip/api.py`'s `require_runtime_token`. The pipeline execution and in-memory job dict are otherwise unchanged (Task 1). Final video output is then uploaded to Cloudflare R2 instead of served via `StaticFiles`, mirroring `services/ai-clip/r2_upload.py` (Task 2), which also wires up the `npm run dev:micro-drama` service-startup script.

**Tech Stack:** Python 3.10+, FastAPI, `boto3` (R2/S3-compatible upload), `fastapi.testclient.TestClient` + `unittest.mock` for tests (no new test framework — `TestClient` ships with FastAPI's existing dependency tree).

## Global Constraints

- Auth pattern must match `services/ai-clip/api.py`'s `require_runtime_token` exactly: header `X-NexoClip-Runtime-Token`, compared via `secrets.compare_digest` against env `MICRODRAMA_RUNTIME_TOKEN`, `401` on missing/mismatch.
- `GET /api/health` stays public, unauthenticated (matches `ai-clip`'s public `/healthz`).
- The old public endpoints (`/api/generate`, `/api/status/{job_id}`, `/api/result/{job_id}`) are **removed**, not kept alongside the new internal ones — no dual surface.
- SSE is kept for the streaming endpoint (not converted to plain polling) — the pipeline reports many discrete progress stages and this is an explicit design decision in the spec, not an oversight.
- `POST /internal/v1/microdrama-jobs` accepts and stores `workspace_id` on the job dict for forward compatibility with a later sub-project's tenant-aware proxy — it is not used for anything else in this plan (no per-workspace credential resolution here).
- R2 upload uses the same env vars already present in the repo root `.env.local` and already used by `services/ai-clip`: `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`. Do not invent new env var names for these.
- Jangan mengubah perubahan user yang sudah ada di working tree di luar file yang disebutkan di masing-masing task.

---

### Task 1: Internal token-authenticated API surface

**Files:**
- Modify: `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/api.py`
- Create: `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/tests/__init__.py` (empty file, makes `tests` an importable package)
- Create: `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/tests/test_internal_api.py`

**Interfaces:**
- Consumes: nothing from other tasks (this is the first task).
- Produces: `require_runtime_token` (FastAPI dependency, no args, raises `HTTPException(401)` on missing/mismatched token) — Task 2 does not need to call this directly, but must not remove or bypass it when it touches `run_pipeline`. The job dict shape gains a `workspace_id` key (`str | None`) that Task 2's R2 logic does not need to read but must preserve when it modifies the dict.

- [ ] **Step 1: Write the failing tests**

Create `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/tests/__init__.py` (empty file).

Create `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/tests/test_internal_api.py`:

```python
import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ["MICRODRAMA_RUNTIME_TOKEN"] = "test-secret-token"

from api import app  # noqa: E402  (env var must be set before import)

client = TestClient(app)


def test_create_job_without_token_is_401():
    response = client.post("/internal/v1/microdrama-jobs", json={"idea": "a robot learns to dance"})
    assert response.status_code == 401


def test_create_job_with_wrong_token_is_401():
    response = client.post(
        "/internal/v1/microdrama-jobs",
        json={"idea": "a robot learns to dance"},
        headers={"X-NexoClip-Runtime-Token": "wrong-token"},
    )
    assert response.status_code == 401


def test_get_job_without_token_is_401():
    response = client.get("/internal/v1/microdrama-jobs/some-id")
    assert response.status_code == 401


def test_create_job_with_correct_token_returns_job_id():
    with patch("api.Idea2VideoPipeline") as MockPipeline:
        MockPipeline.return_value.run = AsyncMock(return_value="outputs/fake-job/final.mp4")
        response = client.post(
            "/internal/v1/microdrama-jobs",
            json={"idea": "a robot learns to dance", "workspace_id": "ws-123"},
            headers={"X-NexoClip-Runtime-Token": "test-secret-token"},
        )
    assert response.status_code == 202
    body = response.json()
    assert "id" in body
    assert body["status"] == "running"


def test_get_unknown_job_is_404():
    response = client.get(
        "/internal/v1/microdrama-jobs/does-not-exist",
        headers={"X-NexoClip-Runtime-Token": "test-secret-token"},
    )
    assert response.status_code == 404


def test_health_endpoint_requires_no_token():
    response = client.get("/api/health")
    assert response.status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd nexoclip-app/services/Open-AI-Micro-Drama-Generator/server && python3 -m pytest tests/test_internal_api.py -v`
Expected: FAIL — `/internal/v1/microdrama-jobs` doesn't exist yet (404s where the tests expect 401/202/404-for-unknown-id, or import errors if `api.py` doesn't yet reference `Idea2VideoPipeline` at module scope in a patchable way — it already does, per the existing file).

- [ ] **Step 3: Add the auth dependency and `workspace_id` field**

In `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/api.py`, change the import block:

```python
import asyncio
import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from pipelines.idea2video import Idea2VideoPipeline
from pipelines.script2video import Script2VideoPipeline
from agents.character_extractor import CharacterExtractor
```

to:

```python
import asyncio
import json
import os
import uuid
from pathlib import Path
from secrets import compare_digest
from typing import Any, Dict

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, BackgroundTasks, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from pipelines.idea2video import Idea2VideoPipeline
from pipelines.script2video import Script2VideoPipeline
from agents.character_extractor import CharacterExtractor
```

(`JSONResponse` was unused in the original file — dropped since this import block is being rewritten anyway.)

Add, right after the `app.add_middleware(...)` block and before the `OUTPUTS_DIR` setup:

```python
def require_runtime_token(
    x_nexoclip_runtime_token: str | None = Header(default=None),
) -> None:
    expected = os.environ.get("MICRODRAMA_RUNTIME_TOKEN", "")
    if not expected or not x_nexoclip_runtime_token or not compare_digest(x_nexoclip_runtime_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
```

Change `GenerateRequest` to add `workspace_id`:

```python
class GenerateRequest(BaseModel):
    idea: str
    user_requirement: str = ""
    style: str = "Cinematic"
    mode: str = "idea2video"  # "idea2video" or "script2video"
    script: str = ""          # used when mode == "script2video"
    workspace_id: str | None = None
```

- [ ] **Step 4: Store `workspace_id` on the job dict**

In `run_pipeline`... no change needed there (it already reads `job = jobs[job_id]`, and Step 5 below adds `workspace_id` at job-creation time, not inside `run_pipeline`).

- [ ] **Step 5: Replace the public endpoints with the internal, token-gated surface**

Find the entire block from `@app.get("/api/health")` through the end of `get_result` (i.e. everything under the `# Endpoints` header down to, but not including, the `# Entry point` section):

```python
# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "microdrama-api"}


@app.post("/api/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "running",
        "events": [],
        "video_url": None,
        "error": None,
        "queue": asyncio.Queue(),
    }
    background_tasks.add_task(run_pipeline, job_id, req)
    return GenerateResponse(job_id=job_id)


@app.get("/api/status/{job_id}")
async def status_stream(job_id: str):
    """SSE endpoint — streams progress events until job completes or fails."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]

    async def event_generator():
        # Replay already-emitted events first (in case client reconnects)
        for event in job["events"]:
            yield f"data: {json.dumps(event)}\n\n"

        # If job is already done, we've replayed everything — finish
        if job["status"] in ("completed", "failed"):
            return

        # Otherwise stream live events from queue
        queue: asyncio.Queue = job["queue"]
        while True:
            event = await queue.get()
            if event is None:
                # Sentinel — pipeline finished
                break
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("type") in ("complete", "error"):
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/result/{job_id}", response_model=JobResult)
async def get_result(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    return JobResult(
        job_id=job_id,
        status=job["status"],
        video_url=job.get("video_url"),
        error=job.get("error"),
    )
```

Replace with:

```python
# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "microdrama-api"}


@app.post("/internal/v1/microdrama-jobs", status_code=status.HTTP_202_ACCEPTED)
async def create_job(
    req: GenerateRequest,
    background_tasks: BackgroundTasks,
    _: None = Depends(require_runtime_token),
) -> dict[str, str]:
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "running",
        "events": [],
        "video_url": None,
        "error": None,
        "queue": asyncio.Queue(),
        "workspace_id": req.workspace_id,
    }
    background_tasks.add_task(run_pipeline, job_id, req)
    return {"id": job_id, "status": "running"}


@app.get("/internal/v1/microdrama-jobs/{job_id}/stream")
async def stream_job(job_id: str, _: None = Depends(require_runtime_token)):
    """SSE endpoint — streams progress events until job completes or fails."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]

    async def event_generator():
        # Replay already-emitted events first (in case client reconnects)
        for event in job["events"]:
            yield f"data: {json.dumps(event)}\n\n"

        # If job is already done, we've replayed everything — finish
        if job["status"] in ("completed", "failed"):
            return

        # Otherwise stream live events from queue
        queue: asyncio.Queue = job["queue"]
        while True:
            event = await queue.get()
            if event is None:
                # Sentinel — pipeline finished
                break
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("type") in ("complete", "error"):
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/internal/v1/microdrama-jobs/{job_id}", response_model=JobResult)
async def get_job(job_id: str, _: None = Depends(require_runtime_token)):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    return JobResult(
        job_id=job_id,
        status=job["status"],
        video_url=job.get("video_url"),
        error=job.get("error"),
    )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd nexoclip-app/services/Open-AI-Micro-Drama-Generator/server && python3 -m pytest tests/test_internal_api.py -v`
Expected: PASS, 6/6 passed. (If `pytest` is not installed in this environment, run `pip install pytest` first — it's a new dev-only addition, add it to a `requirements-dev.txt` alongside `pytest` per Task 2's step for `requirements.txt`, or install ad hoc; either way the test file itself does not change.)

- [ ] **Step 7: Commit**

```bash
cd nexoclip-app
git add services/Open-AI-Micro-Drama-Generator/server/api.py services/Open-AI-Micro-Drama-Generator/server/tests/
git commit -m "feat: replace MicroDrama's public API with internal token-authenticated surface"
```

---

### Task 2: R2 output storage + service startup wiring

**Files:**
- Create: `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/r2_upload.py`
- Modify: `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/api.py`
- Modify: `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/requirements.txt`
- Modify: `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/.env.example`
- Modify: `nexoclip-app/package.json`
- Modify: `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/tests/test_internal_api.py`

**Interfaces:**
- Consumes: Task 1's `jobs` dict (module-level, in `api.py`), `run_pipeline`, `require_runtime_token` — unchanged signatures, this task only edits `run_pipeline`'s body.
- Produces: `upload_file_to_r2(local_path: str, key: str, content_type: str) -> str` in `r2_upload.py` (returns the public R2 URL) — no other task in this plan consumes it, but it's the same name/signature as `services/ai-clip/r2_upload.py` for consistency across services.

- [ ] **Step 1: Write the failing test for upload failure**

Append to `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/tests/test_internal_api.py`:

```python
def test_pipeline_success_uploads_to_r2_and_completes():
    with patch("api.Idea2VideoPipeline") as MockPipeline, patch("api.upload_file_to_r2") as mock_upload:
        MockPipeline.return_value.run = AsyncMock(return_value="outputs/fake-job/final.mp4")
        mock_upload.return_value = "https://cdn.example.com/microdrama/fake-job/final.mp4"

        create_response = client.post(
            "/internal/v1/microdrama-jobs",
            json={"idea": "a robot learns to dance"},
            headers={"X-NexoClip-Runtime-Token": "test-secret-token"},
        )
        job_id = create_response.json()["id"]

        # run_pipeline is scheduled as a BackgroundTask; TestClient runs it
        # synchronously as part of request handling, so it's already done here.
        result = client.get(
            f"/internal/v1/microdrama-jobs/{job_id}",
            headers={"X-NexoClip-Runtime-Token": "test-secret-token"},
        )

    assert result.json()["status"] == "completed"
    assert result.json()["video_url"] == "https://cdn.example.com/microdrama/fake-job/final.mp4"
    mock_upload.assert_called_once()


def test_pipeline_success_but_r2_upload_failure_marks_job_failed():
    with patch("api.Idea2VideoPipeline") as MockPipeline, patch("api.upload_file_to_r2") as mock_upload:
        MockPipeline.return_value.run = AsyncMock(return_value="outputs/fake-job-2/final.mp4")
        mock_upload.side_effect = RuntimeError("R2 bucket unreachable")

        create_response = client.post(
            "/internal/v1/microdrama-jobs",
            json={"idea": "a robot learns to dance"},
            headers={"X-NexoClip-Runtime-Token": "test-secret-token"},
        )
        job_id = create_response.json()["id"]

        result = client.get(
            f"/internal/v1/microdrama-jobs/{job_id}",
            headers={"X-NexoClip-Runtime-Token": "test-secret-token"},
        )

    assert result.json()["status"] == "failed"
    assert "upload to storage failed" in result.json()["error"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd nexoclip-app/services/Open-AI-Micro-Drama-Generator/server && python3 -m pytest tests/test_internal_api.py -v`
Expected: the 6 tests from Task 1 still PASS; the 2 new tests FAIL (`AttributeError` or similar — `api.upload_file_to_r2` doesn't exist yet, and today's code sets `video_url` to a local `/outputs/...` path, not the mocked R2 URL).

- [ ] **Step 3: Create `r2_upload.py`**

Create `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/r2_upload.py` (identical to `services/ai-clip/r2_upload.py`, same bucket/credentials contract):

```python
"""Minimal Cloudflare R2 (S3-compatible) uploader — same bucket the Node app uses."""
from __future__ import annotations

import os

import boto3


def _client():
    account_id = os.environ["R2_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def upload_file_to_r2(local_path: str, key: str, content_type: str) -> str:
    bucket = os.environ["R2_BUCKET"]
    public_url = os.environ["R2_PUBLIC_URL"].rstrip("/")
    _client().upload_file(local_path, bucket, key, ExtraArgs={"ContentType": content_type})
    return f"{public_url}/{key}"
```

- [ ] **Step 4: Wire the upload into `run_pipeline`**

In `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/api.py`, add the import (next to the other local imports):

```python
from pipelines.idea2video import Idea2VideoPipeline
from pipelines.script2video import Script2VideoPipeline
from agents.character_extractor import CharacterExtractor
from r2_upload import upload_file_to_r2
```

Find, inside `run_pipeline`:

```python
        # Convert local path to URL
        rel_path = Path(video_path).relative_to(Path("."))
        video_url = f"/{rel_path}"

        job["status"] = "completed"
        job["video_url"] = video_url
```

Replace with:

```python
        # Upload the final video to R2 — a local path is not reachable by
        # the browser once this service is called only from the Next.js
        # backend, not served directly.
        try:
            video_url = upload_file_to_r2(
                video_path,
                key=f"microdrama/{job_id}/final.mp4",
                content_type="video/mp4",
            )
        except Exception as upload_exc:
            raise RuntimeError(f"Video generated but upload to storage failed: {upload_exc}") from upload_exc

        job["status"] = "completed"
        job["video_url"] = video_url
```

This raises out of the `try` block already surrounding pipeline execution in `run_pipeline`, so it's caught by the existing `except Exception as exc:` clause below (unchanged) and produces a `"failed"` job with the wrapped message — no separate except block needed.

- [ ] **Step 5: Remove the now-unused local static file serving**

Find:

```python
# Ensure outputs directory exists on startup
OUTPUTS_DIR = Path("outputs")
OUTPUTS_DIR.mkdir(exist_ok=True)

app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")
```

Replace with:

```python
# Local scratch directory for pipeline intermediates before R2 upload —
# no longer served over HTTP (see r2_upload.py).
OUTPUTS_DIR = Path("outputs")
OUTPUTS_DIR.mkdir(exist_ok=True)
```

Then remove the now-unused `from fastapi.staticfiles import StaticFiles` import line.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd nexoclip-app/services/Open-AI-Micro-Drama-Generator/server && python3 -m pytest tests/test_internal_api.py -v`
Expected: all 8 tests PASS.

- [ ] **Step 7: Add `boto3` to `requirements.txt`**

In `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/requirements.txt`, add a line:

```
boto3>=1.34
```

- [ ] **Step 8: Update `.env.example`**

In `nexoclip-app/services/Open-AI-Micro-Drama-Generator/server/.env.example`, add (at the top, before the existing `MUAPI_KEY` line):

```
# Set by the Next.js app's server-side proxy when calling this service
# internally — this service must never be reachable from the browser.
MICRODRAMA_RUNTIME_TOKEN=set_a_long_random_shared_secret

# Cloudflare R2 (S3-compatible) — same bucket/credentials already used by
# services/ai-clip, set these to the same values as the repo root .env.local.
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=

MUAPI_KEY=your_api_key_here
```

- [ ] **Step 9: Add the service-startup script**

In `nexoclip-app/package.json`, find:

```json
    "dev:ai-clip": "cd services/ai-clip && set -a && . ../../.env.local && set +a && .venv/bin/uvicorn api:app --host 127.0.0.1 --port 4175",
```

Add immediately after it:

```json
    "dev:micro-drama": "cd services/Open-AI-Micro-Drama-Generator/server && set -a && . ../../../.env.local && set +a && .venv/bin/uvicorn api:app --host 127.0.0.1 --port 4176",
```

(Port 4176 — next free port after `vimax` on 4174 and `ai-clip` on 4175.)

- [ ] **Step 10: Commit**

```bash
cd nexoclip-app
git add services/Open-AI-Micro-Drama-Generator/server/r2_upload.py services/Open-AI-Micro-Drama-Generator/server/api.py services/Open-AI-Micro-Drama-Generator/server/requirements.txt services/Open-AI-Micro-Drama-Generator/server/.env.example services/Open-AI-Micro-Drama-Generator/server/tests/test_internal_api.py package.json
git commit -m "feat: upload MicroDrama output to R2, add dev:micro-drama service script"
```

---

## Manual verification (no live credentials in a sandboxed environment — run once real R2/MUAPI credentials are available)

- [ ] **Step 1**: `cd nexoclip-app/services/Open-AI-Micro-Drama-Generator/server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
- [ ] **Step 2**: From `nexoclip-app`, run `npm run dev:micro-drama` — confirm it starts on port 4176 without import errors.
- [ ] **Step 3**: `curl http://127.0.0.1:4176/api/health` — expect `{"status":"ok","service":"microdrama-api"}` with no auth header needed.
- [ ] **Step 4**: `curl -X POST http://127.0.0.1:4176/internal/v1/microdrama-jobs -H "Content-Type: application/json" -H "X-NexoClip-Runtime-Token: <value from .env.local>" -d '{"idea":"a robot learns to dance"}'` — expect `202` with a job id. Then poll `curl http://127.0.0.1:4176/internal/v1/microdrama-jobs/<id> -H "X-NexoClip-Runtime-Token: ..."` until `status` is `completed`, and confirm `video_url` is a real `R2_PUBLIC_URL`-prefixed URL that plays in a browser.
- [ ] **Step 5**: Repeat Step 4 without the `X-NexoClip-Runtime-Token` header — expect `401`.
