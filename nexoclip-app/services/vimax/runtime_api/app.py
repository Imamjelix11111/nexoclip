from __future__ import annotations

import os
from typing import Any, Literal
from secrets import compare_digest

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from .executor import RuntimeExecutor


class ExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_id: str = Field(min_length=1, max_length=96)
    kind: Literal["vimax_narrative_planning", "vimax_novel_planning", "vimax_render_video"]
    session_id: str = Field(default="", max_length=96)
    input: dict[str, Any] = Field(default_factory=dict)


def require_runtime_token(
    x_nexoclip_runtime_token: str | None = Header(default=None),
) -> None:
    expected = os.environ.get("VIMAX_RUNTIME_TOKEN", "")
    if not expected or not x_nexoclip_runtime_token or not compare_digest(x_nexoclip_runtime_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def create_app(*, executor: RuntimeExecutor | Any | None = None) -> FastAPI:
    app = FastAPI()
    runtime_executor = executor or RuntimeExecutor()

    @app.get("/healthz")
    async def healthz() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/internal/v1/jobs/{job_id}/execute")
    async def execute(
        job_id: str,
        request: ExecuteRequest,
        _: None = Depends(require_runtime_token),
    ) -> dict[str, Any]:
        return await runtime_executor.execute(
            job_id=job_id,
            workspace_id=request.workspace_id,
            kind=request.kind,
            session_id=request.session_id,
            args=request.input,
        )

    return app


app = create_app()
