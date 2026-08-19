"""Private HTTP wrapper around shorts_generator (mode="local", no MuAPI).

Called only by the Next.js app's server-side proxy, never directly by the
browser. Authenticated with a shared token, same pattern as the ViMax
runtime (services/vimax/runtime_api/app.py).

Run with: uvicorn api:app --host 127.0.0.1 --port 4175
"""
from __future__ import annotations

import os
import shutil
import threading
import uuid
from secrets import compare_digest
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from r2_upload import upload_file_to_r2
from shorts_generator import generate_shorts

app = FastAPI()

_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()


def require_runtime_token(
    x_nexoclip_runtime_token: str | None = Header(default=None),
) -> None:
    expected = os.environ.get("AI_CLIP_RUNTIME_TOKEN", "")
    if not expected or not x_nexoclip_runtime_token or not compare_digest(x_nexoclip_runtime_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


class ClipRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    video_url: str = Field(min_length=1, max_length=2048)
    num_clips: int = Field(default=3, ge=1, le=10)
    aspect_ratio: Literal["9:16", "16:9", "1:1"] = "9:16"
    workspace_id: str = Field(min_length=1, max_length=96)
    topic_hint: str = Field(default="", max_length=500)


def _run_job(job_id: str, req: ClipRequest) -> None:
    # Each job gets its own working directory — sharing one lets concurrent jobs
    # overwrite each other's intermediate files mid-write (silent corruption).
    job_dir = os.path.join(os.environ.get("LOCAL_OUTPUT_DIR", "output"), job_id)
    try:
        result = generate_shorts(
            youtube_url=req.video_url,
            num_clips=req.num_clips,
            aspect_ratio=req.aspect_ratio,
            mode="local",
            topic_hint=req.topic_hint or None,
            out_dir=job_dir,
        )
        shorts = []
        for short in result.get("shorts", []):
            local_path = short.get("clip_path") or short.get("clip_url")
            url = None
            if local_path and os.path.exists(local_path):
                key = f"{req.workspace_id}/ai-clip/{uuid.uuid4()}.mp4"
                url = upload_file_to_r2(local_path, key, "video/mp4")
            shorts.append({
                "title": short.get("title"),
                "hook_sentence": short.get("hook_sentence"),
                "start_time": short.get("start_time"),
                "end_time": short.get("end_time"),
                "score": short.get("score"),
                "url": url,
                "error": short.get("error") if not url else None,
            })
        with _JOBS_LOCK:
            _JOBS[job_id] = {"status": "completed", "shorts": shorts}
    except Exception as exc:  # noqa: BLE001 — job worker boundary, must never crash the thread silently
        with _JOBS_LOCK:
            _JOBS[job_id] = {"status": "failed", "error": str(exc)}
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


@app.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/internal/v1/clip-jobs", status_code=status.HTTP_202_ACCEPTED)
async def create_clip_job(req: ClipRequest, _: None = Depends(require_runtime_token)) -> dict[str, str]:
    job_id = str(uuid.uuid4())
    with _JOBS_LOCK:
        _JOBS[job_id] = {"status": "pending"}
    thread = threading.Thread(target=_run_job, args=(job_id, req), daemon=True)
    thread.start()
    return {"id": job_id, "status": "pending"}


@app.get("/internal/v1/clip-jobs/{job_id}")
async def get_clip_job(job_id: str, _: None = Depends(require_runtime_token)) -> dict[str, Any]:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return {"id": job_id, **job}
