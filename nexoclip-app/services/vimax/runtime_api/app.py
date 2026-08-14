from __future__ import annotations

import os
from typing import Any, Literal
from secrets import compare_digest

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .executor import RuntimeExecutor


MAX_EXECUTE_BODY_BYTES = 1_000_000
EXECUTE_PATH_PREFIX = "/internal/v1/jobs/"


class RuntimeBoundaryMiddleware:
    """Authenticate and bound private execute bodies before FastAPI reads them."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or not scope["path"].startswith(EXECUTE_PATH_PREFIX):
            await self.app(scope, receive, send)
            return

        headers = dict(scope["headers"])
        expected = os.environ.get("VIMAX_RUNTIME_TOKEN", "")
        token = headers.get(b"x-nexoclip-runtime-token", b"").decode("latin-1")
        if not expected or not token or not compare_digest(token, expected):
            await JSONResponse({"detail": "Unauthorized"}, status_code=status.HTTP_401_UNAUTHORIZED)(scope, receive, send)
            return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > MAX_EXECUTE_BODY_BYTES:
                await JSONResponse({"detail": "Request body too large"}, status_code=status.HTTP_413_CONTENT_TOO_LARGE)(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        sent = False

        async def replay_receive() -> dict[str, Any]:
            nonlocal sent
            if sent:
                return {"type": "http.disconnect"}
            sent = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay_receive, send)


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
    app.add_middleware(RuntimeBoundaryMiddleware)
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
        try:
            return await runtime_executor.execute(
                job_id=job_id,
                workspace_id=request.workspace_id,
                kind=request.kind,
                session_id=request.session_id,
                args=request.input,
            )
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid execution request") from None

    return app


app = create_app()
