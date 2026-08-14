import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agent_runtime.models import ToolResult
from runtime_api.app import create_app
from runtime_api.executor import RuntimeExecutor


class FakeExecutor:
    def __init__(self, tenant_root):
        self.tenant_root = tenant_root
        self.calls = []

    async def execute(self, *, job_id, workspace_id, kind, session_id, args):
        self.calls.append((job_id, workspace_id, kind))
        return {"job_id": job_id, "ok": True, "result": {}, "progress": []}


def payload(**overrides):
    request = {
        "workspace_id": "workspace-1",
        "kind": "vimax_narrative_planning",
        "session_id": "session-1",
        "input": {},
    }
    request.update(overrides)
    return request


def test_execute_rejects_missing_service_token(monkeypatch, tmp_path):
    monkeypatch.setenv("VIMAX_RUNTIME_TOKEN", "test-token")
    client = TestClient(create_app(executor=FakeExecutor(tmp_path)))

    response = client.post("/internal/v1/jobs/job-1/execute", json=payload())

    assert response.status_code == 401


def test_execute_maps_unknown_workspace_session_to_non_retryable_bad_request(monkeypatch, tmp_path):
    monkeypatch.setenv("VIMAX_RUNTIME_TOKEN", "test-token")

    class MissingSessionExecutor:
        async def execute(self, **kwargs):
            raise ValueError("Unknown workspace session")

    client = TestClient(create_app(executor=MissingSessionExecutor()))
    response = client.post(
        "/internal/v1/jobs/job-1/execute",
        headers={"X-NexoClip-Runtime-Token": "test-token"},
        json=payload(),
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid execution request"}


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


def test_execute_rejects_unstructured_request_fields(monkeypatch, tmp_path):
    monkeypatch.setenv("VIMAX_RUNTIME_TOKEN", "test-token")
    client = TestClient(create_app(executor=FakeExecutor(tmp_path)))

    response = client.post(
        "/internal/v1/jobs/job-1/execute",
        headers={"X-NexoClip-Runtime-Token": "test-token"},
        json={**payload(), "tenant_root": str(tmp_path / "escaped")},
    )

    assert response.status_code == 422


def test_executor_rejects_workspace_traversal(tmp_path):
    executor = RuntimeExecutor(tmp_path / "tenants")

    with pytest.raises(ValueError, match="Invalid workspace_id"):
        asyncio.run(
            executor.execute(
                job_id="job-1",
                workspace_id="../outside",
                kind="vimax_render_video",
                session_id="",
                args={},
            )
        )


def test_execute_authenticates_before_malformed_or_oversized_body_parsing(monkeypatch, tmp_path):
    monkeypatch.setenv("VIMAX_RUNTIME_TOKEN", "test-token")
    client = TestClient(create_app(executor=FakeExecutor(tmp_path)))
    headers = {"Content-Type": "application/json"}

    malformed = client.post("/internal/v1/jobs/job-1/execute", headers=headers, content=b"{")
    invalid = client.post(
        "/internal/v1/jobs/job-1/execute",
        headers={**headers, "X-NexoClip-Runtime-Token": "invalid"},
        content=b"{" + b"x" * (1024 * 1024),
    )
    oversized = client.post(
        "/internal/v1/jobs/job-1/execute",
        headers=headers,
        content=b"{" + b"x" * (1024 * 1024),
    )

    assert malformed.status_code == 401
    assert invalid.status_code == 401
    assert oversized.status_code == 401


def test_execute_rejects_authenticated_oversized_body(monkeypatch, tmp_path):
    monkeypatch.setenv("VIMAX_RUNTIME_TOKEN", "test-token")
    client = TestClient(create_app(executor=FakeExecutor(tmp_path)))

    response = client.post(
        "/internal/v1/jobs/job-1/execute",
        headers={"Content-Type": "application/json", "X-NexoClip-Runtime-Token": "test-token"},
        content=b"{" + b"x" * (1024 * 1024),
    )

    assert response.status_code == 413


def test_executor_rejects_session_missing_from_workspace_index(monkeypatch, tmp_path):
    root = tmp_path / "tenants"

    class FakeAdapters:
        def __init__(self, workspace_root, session_index):
            pytest.fail("adapter must not run for an unknown workspace session")

    monkeypatch.setattr("runtime_api.executor.ViMaxAdapters", FakeAdapters)

    with pytest.raises(ValueError, match="Unknown workspace session"):
        asyncio.run(
            RuntimeExecutor(root).execute(
                job_id="job-1", workspace_id="workspace-1", kind="vimax_render_video", session_id="missing", args={}
            )
        )


def test_executor_sanitizes_absolute_paths_and_serializes_workspace_session(monkeypatch, tmp_path):
    root = tmp_path / "tenants"
    events: list[str] = []

    class FakeSessionIndex:
        def __init__(self, workspace_root):
            events.append(f"index:{workspace_root}")

        def get(self, session_id):
            return {"session_id": session_id}

    class FakeAdapters:
        active = 0
        max_active = 0

        def __init__(self, workspace_root, session_index):
            assert workspace_root == root / "workspace-1"
            self.workspace_root = workspace_root

        async def vimax_render_video(self, args, runtime):
            FakeAdapters.active += 1
            FakeAdapters.max_active = max(FakeAdapters.max_active, FakeAdapters.active)
            runtime.emit_progress("rendering", metadata={"generated": [Path("/private/progress.mp4")]})
            await asyncio.sleep(0)
            FakeAdapters.active -= 1
            return ToolResult(
                "vimax_render_video",
                True,
                "done",
                {"generated": [self.workspace_root / "clip.mp4", "/private/result.mp4"]},
            )

    monkeypatch.setattr("runtime_api.executor.SessionIndex", FakeSessionIndex)
    monkeypatch.setattr("runtime_api.executor.ViMaxAdapters", FakeAdapters)
    executor = RuntimeExecutor(root)

    async def execute_twice():
        return await asyncio.gather(
            executor.execute(job_id="job-1", workspace_id="workspace-1", kind="vimax_render_video", session_id="s1", args={}),
            executor.execute(job_id="job-2", workspace_id="workspace-1", kind="vimax_render_video", session_id="s1", args={}),
        )

    results = asyncio.run(execute_twice())

    assert FakeAdapters.max_active == 1
    assert events == [f"index:{root / 'workspace-1'}", f"index:{root / 'workspace-1'}"]
    assert results[0]["result"] == {"generated": ["workspace-1/clip.mp4", "[redacted-path]"]}
    assert results[0]["progress"][0]["progress"]["metadata"] == {"generated": ["progress.mp4"]}


def test_executor_response_dto_redacts_embedded_paths_and_drops_unknown_objects(monkeypatch, tmp_path):
    root = tmp_path / "tenants"

    class AbsolutePathString:
        def __str__(self):
            return "/host/private/key.pem"

    class FakeSessionIndex:
        def __init__(self, workspace_root):
            pass

        def get(self, session_id):
            return {"session_id": session_id}

    class FakeAdapters:
        def __init__(self, workspace_root, session_index):
            pass

        async def vimax_render_video(self, args, runtime):
            runtime.emit_progress(
                "render failed at /app/.tenants/workspace-1/private clip.mp4",
                metadata={
                    "error": "read /app/.tenants/workspace-1/private clip.mp4",
                    "generated": ["artifacts/clip.mp4"],
                    "unknown": AbsolutePathString(),
                },
            )
            return ToolResult(
                "vimax_render_video",
                False,
                "failure at /app/.tenants/workspace-1/private clip.mp4",
                {
                    "error": "read /app/.tenants/workspace-1/private clip.mp4",
                    "generated": ["artifacts/clip.mp4"],
                    "unknown": AbsolutePathString(),
                },
            )

    monkeypatch.setattr("runtime_api.executor.SessionIndex", FakeSessionIndex)
    monkeypatch.setattr("runtime_api.executor.ViMaxAdapters", FakeAdapters)

    result = asyncio.run(
        RuntimeExecutor(root).execute(
            job_id="job-1", workspace_id="workspace-1", kind="vimax_render_video", session_id="s1", args={}
        )
    )
    rendered = str(result)

    assert "/app/.tenants/workspace-1/private clip.mp4" not in rendered
    assert "[redacted-path] clip.mp4" not in rendered
    assert result["result"]["error"] == "read [redacted-path]"
    assert result["progress"][0]["progress"]["message"] == "render failed at [redacted-path]"
    assert "unknown" not in result["result"]
    assert result["result"]["generated"] == ["artifacts/clip.mp4"]
    assert result["progress"][0]["progress"]["metadata"]["generated"] == ["artifacts/clip.mp4"]
