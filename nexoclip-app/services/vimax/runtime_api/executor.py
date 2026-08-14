from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from typing import Any, Literal

from agent_runtime.session_index import SessionIndex
from agent_runtime.tools import ToolRuntimeContext
from agent_runtime.vimax_adapters import ViMaxAdapters

ExecutionKind = Literal[
    "vimax_narrative_planning",
    "vimax_novel_planning",
    "vimax_render_video",
]

_RESPONSE_METADATA_KEYS = frozenset({
    "error", "error_type", "final_video_path", "generated", "missing", "present",
    "ready_for_render", "ready_for_scene_render", "render_completed", "render_mode",
    "render_started", "reused", "revised", "retryable", "revision_target",
    "scene_count", "scene_render_completed", "scene_video_dirs", "scene_videos_dir",
    "session_id", "stale", "timeout_seconds", "wrapped_error", "working_dir",
})
_PROGRESS_METADATA_KEYS = _RESPONSE_METADATA_KEYS | frozenset({"max_tokens", "scene_index"})
_DROP = object()
_FILE_URL = re.compile(r"file://[^\s\"'<>]+", re.IGNORECASE)
_ABSOLUTE_PATH = re.compile(r"(?<![\w.-])(?:/[\w.~@%+=:,;()\[\]{}-]+)+(?:/)?|(?<![\w.-])[A-Za-z]:[\\/][^\s\"'<>]*")


class RuntimeExecutor:
    def __init__(self, tenants_root: str | Path | None = None) -> None:
        self.tenants_root = Path(tenants_root or os.environ.get("VIMAX_TENANTS_ROOT", ".tenants")).resolve()
        self._locks: dict[str, asyncio.Lock] = {}

    async def execute(
        self,
        *,
        job_id: str,
        workspace_id: str,
        kind: ExecutionKind,
        session_id: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        workspace_id = self._normalize_workspace_id(workspace_id)
        session_id = self._normalize_session_id(session_id)
        lock = self._locks.setdefault(f"{workspace_id}:{session_id or 'workspace'}", asyncio.Lock())
        progress: list[dict[str, Any]] = []

        async with lock:
            tenant_root = self._tenant_root(workspace_id)
            session_index = SessionIndex(tenant_root)
            adapter = ViMaxAdapters(tenant_root, session_index)
            runtime = ToolRuntimeContext(
                requested_name=kind,
                canonical_name=kind,
                turn_id=job_id,
                progress_callback=lambda event: progress.append(self._progress_dto(event)),
            )
            method = getattr(adapter, kind)
            result = await method({**args, "session_id": session_id or args.get("session_id", "")}, runtime)

        return {
            "job_id": job_id,
            "ok": result.ok,
            "result": self._result_dto(result.metadata),
            "progress": progress,
        }

    def _tenant_root(self, workspace_id: str) -> Path:
        root = self.tenants_root / workspace_id
        root.mkdir(parents=True, exist_ok=True)
        resolved = root.resolve()
        if resolved.parent != self.tenants_root:
            raise ValueError("Invalid workspace_id")
        return resolved

    @staticmethod
    def _normalize_workspace_id(workspace_id: str) -> str:
        value = str(workspace_id).strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,95}", value):
            raise ValueError("Invalid workspace_id")
        return value

    @staticmethod
    def _normalize_session_id(session_id: str) -> str:
        value = str(session_id).strip()
        if not value:
            return ""
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,95}", value):
            raise ValueError("Invalid session_id")
        return value

    def _result_dto(self, metadata: Any) -> dict[str, Any]:
        return self._metadata_dto(metadata, _RESPONSE_METADATA_KEYS)

    def _progress_dto(self, event: Any) -> dict[str, Any]:
        progress = event.get("progress", {}) if isinstance(event, dict) else {}
        tool = event.get("tool", {}) if isinstance(event, dict) else {}
        return {
            "type": "tool_progress",
            "tool": {"name": str(tool.get("name", ""))},
            "progress": {
                "stage": self._safe_text(progress.get("stage", "running")),
                "message": self._safe_text(progress.get("message", "")),
                "metadata": self._metadata_dto(progress.get("metadata"), _PROGRESS_METADATA_KEYS),
            },
        }

    def _metadata_dto(self, metadata: Any, allowed_keys: frozenset[str]) -> dict[str, Any]:
        if not isinstance(metadata, dict):
            return {}
        response: dict[str, Any] = {}
        for key in allowed_keys:
            value = self._safe_metadata_value(metadata.get(key, _DROP))
            if value is not _DROP:
                response[key] = value
        return response

    def _safe_metadata_value(self, value: Any) -> Any:
        if value is _DROP:
            return _DROP
        if isinstance(value, Path):
            return self._safe_path(value)
        if isinstance(value, str):
            return self._safe_text(value)
        if value is None or isinstance(value, bool | int | float):
            return value
        if isinstance(value, list | tuple):
            values = [self._safe_metadata_value(item) for item in value]
            return [item for item in values if item is not _DROP]
        return _DROP

    def _safe_path(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.tenants_root).as_posix()
        except ValueError:
            return path.name

    @staticmethod
    def _safe_text(value: Any) -> str:
        text = value if isinstance(value, str) else ""
        text = _FILE_URL.sub("[redacted-path]", text)
        return _ABSOLUTE_PATH.sub("[redacted-path]", text)
