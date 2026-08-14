# Task 2 report: private FastAPI ViMax runtime

## Scope and preservation

Only Task 2 runtime files were staged for the Task 2 commit. Existing Task 1 commit `4573013 feat: persist ViMax generation progress` was preserved. Unrelated dirty files were not staged or changed.

Task 2 files:

- `nexoclip-app/services/vimax/runtime_api/__init__.py`
- `nexoclip-app/services/vimax/runtime_api/app.py`
- `nexoclip-app/services/vimax/runtime_api/executor.py`
- `nexoclip-app/services/vimax/tests/test_runtime_api.py`
- `nexoclip-app/services/vimax/pyproject.toml`
- `nexoclip-app/services/vimax/uv.lock`
- `nexoclip-app/services/vimax/Dockerfile`

## Inherited partial-state validation

The interrupted implementation already contained the FastAPI app, executor, Docker conversion, dependencies, and two endpoint tests. Initial focused validation (using an isolated pytest environment because the local project virtualenv was missing its pytest entrypoint) was:

```text
uv run --isolated --with pytest python -m pytest tests/test_runtime_api.py -q
2 passed, 1 warning
```

Review found that `ExecuteRequest` silently accepted unknown fields. This violated the required trusted, strict structured command boundary: a client could include a `tenant_root` field even though it was ignored. The inherited executor otherwise already used `secrets.compare_digest`, normalized workspace/session identifiers, derived tenant roots below `VIMAX_TENANTS_ROOT`, used workspace/session locks, invoked named `ViMaxAdapters` methods directly, and sanitized response values.

The local `uv run pytest ...` initially failed with `Failed to spawn: pytest` because the pre-existing `.venv` had no pytest launcher despite `pytest` being locked. `uv sync --frozen --reinstall-package pytest` restored the launcher; this did not change project source or lock content.

## Red / green evidence

### Red

Added `test_execute_rejects_unstructured_request_fields`, which submits an authenticated request containing a forbidden `tenant_root` field. Before production alteration:

```text
FAILED tests/test_runtime_api.py::test_execute_rejects_unstructured_request_fields
assert 200 == 422
1 failed, 4 passed, 1 warning
```

This named a concrete boundary break: removing strict-model validation permitted a caller-supplied filesystem-root-shaped field.

### Green

Set `ExecuteRequest.model_config = ConfigDict(extra="forbid")` in `runtime_api/app.py`. Focused runtime test result:

```text
5 passed, 1 warning in 1.98s
```

The final test file covers:

- missing service token rejection;
- authenticated typed adapter dispatch;
- strict rejection of unknown structured-request fields;
- direct executor rejection of traversal workspace IDs;
- per-workspace/session serialization with concurrent invocations;
- tenant root derivation beneath the configured root;
- sanitization of absolute paths from adapter result and progress response data.

## Final verification

```text
cd nexoclip-app/services/vimax && uv lock --check
Resolved 88 packages in 7ms

cd nexoclip-app/services/vimax && uv run python -c "from runtime_api.app import create_app; from runtime_api.executor import RuntimeExecutor; print('runtime-import-ok')"
runtime-import-ok

cd nexoclip-app/services/vimax && uv run pytest tests/test_runtime_api.py -q
5 passed, 1 warning in 1.98s

cd nexoclip-app/services/vimax && uv run pytest tests/test_vimax_adapters.py tests/test_main_agent_cli.py tests/test_runtime_api.py -q
36 passed, 1 warning in 1.39s

rtk git diff --check
exit 0
```

The warning is upstream Starlette's deprecation warning for `fastapi.testclient`'s current `httpx` import; no test failures or application warnings were emitted.

## Commit

`4d80ea32efcb9d82110c353340e1fe2dcd70947d` — `feat: expose ViMax runtime over private FastAPI`

The commit stages only the seven Task 2 file groups named above.

## Concerns

- The runtime is Docker-private only after Task 4 Compose wiring; Task 2 provides the token check but does not itself create the private network topology.
- `asyncio.Lock` serialization is process-local by design. Multiple runtime replicas require a distributed workspace/session lock before concurrent deployment.
- The existing `uv.lock` resolution selects newer compatible FastAPI/Uvicorn versions within the requested constraints; `uv lock --check` verifies the lock is reproducible.

## Re-review 1 — spaced absolute-path response redaction

### Red

Updated the existing response-DTO regression to put the absolute POSIX path `/app/.tenants/workspace-1/private clip.mp4` in both runtime result and progress text, then ran:

```text
cd nexoclip-app/services/vimax && uv run pytest tests/test_runtime_api.py -q
FAILED tests/test_runtime_api.py::test_executor_response_dto_redacts_embedded_paths_and_drops_unknown_objects
assert '[redacted-path] clip.mp4' not in rendered
1 failed, 7 passed, 1 warning
```

The prior component-restricted expression redacted only `/app/.tenants/workspace-1/private`, leaking the ` clip.mp4` suffix.

### Green

`_safe_text` now redacts from an embedded POSIX, drive-letter Windows, or UNC absolute-path marker through the remainder of the response text. This is deliberately conservative: arbitrary adapter/provider text after an absolute-path marker is not part of the allow-listed response representation and is removed rather than risking a filesystem-path leak.

```text
cd nexoclip-app/services/vimax && uv run pytest tests/test_runtime_api.py -q
8 passed, 1 warning in 1.58s

cd nexoclip-app/services/vimax && uv run pytest tests/test_vimax_adapters.py tests/test_main_agent_cli.py tests/test_runtime_api.py -q
39 passed, 1 warning in 1.47s
```

The warning remains the existing upstream Starlette `TestClient`/`httpx` deprecation warning.

### Commit

`2f0c0c2ba6103f70fdc6d3a7637d1f2978d628b9` — `fix: redact spaced runtime paths`

### Concern

The conservative sanitation intentionally removes the remainder of a text field after any absolute-path marker. This prioritizes the required no-path-disclosure guarantee over retaining untrusted adapter diagnostic detail.

## Review-finding remediation — runtime boundary

### Root cause and design

The review findings were reproduced against commit `4d80ea3`. FastAPI validated `ExecuteRequest` before its endpoint dependency ran, so malformed unauthenticated JSON returned `422`. `RuntimeExecutor._safe_value` recursively serialized arbitrary result/progress metadata and used `str()` for unknown objects; its path handling only recognized a whole-string absolute path, allowing embedded paths and `file://` URLs to escape.

The fix keeps the boundary small and Task-2-local:

- `RuntimeBoundaryMiddleware` authenticates the private execute route with `compare_digest` before calling `receive()`, preserving `401` for missing or invalid tokens. Authenticated requests are buffered to an explicit `1,000,000`-byte maximum and return `413` before JSON parsing when exceeded.
- `RuntimeExecutor` now creates explicit response DTOs. Result and progress metadata have allow-listed keys and scalar/list values; unknown objects are dropped rather than stringified. All exposed text is redacted for `file://` URLs and embedded absolute POSIX/Windows paths. Relative artifacts remain usable.

### Red evidence

Added regressions before production changes, then ran:

```text
cd nexoclip-app/services/vimax && uv run pytest tests/test_runtime_api.py -q
FAILED test_execute_authenticates_before_malformed_or_oversized_body_parsing
assert 422 == 401
FAILED test_execute_rejects_authenticated_oversized_body
assert 422 == 413
FAILED test_executor_response_dto_redacts_embedded_paths_and_drops_unknown_objects
assert '/app/.tenants/workspace-1/private.mp4' not in response
3 failed, 5 passed, 1 warning
```

The new tests prove missing and invalid-token malformed/oversized payloads receive `401`, an authenticated oversized payload gets `413`, and embedded absolute paths, `file://` URLs, and `__str__` output from unknown values cannot enter result/progress responses while `artifacts/clip.mp4` survives.

### Green and regression evidence

```text
cd nexoclip-app/services/vimax && uv run pytest tests/test_runtime_api.py -q
8 passed, 1 warning in 1.39s

cd nexoclip-app/services/vimax && uv run pytest tests/test_vimax_adapters.py tests/test_main_agent_cli.py tests/test_runtime_api.py -q
39 passed, 1 warning in 1.72s

rtk git diff --check
exit 0
```

The sole warning is the existing upstream Starlette deprecation warning for `fastapi.testclient` importing the current `httpx` interface.

### Files and commit

Modified only Task 2 runtime files plus this required Task 2 report:

- `nexoclip-app/services/vimax/runtime_api/app.py`
- `nexoclip-app/services/vimax/runtime_api/executor.py`
- `nexoclip-app/services/vimax/tests/test_runtime_api.py`
- `.superpowers/sdd/2026-08-14-durable-vimax-fastapi-runtime/task-2-report.md`

Fix commit: `0f49efe046b93da2c4ecd62572170caa596ba126` — `fix: secure ViMax runtime boundary`.

### Remaining concern

The maximum is enforced in-process after the HTTP server has accepted the stream; deployment should also configure its ingress/proxy request-size limit to the same or lower value for earlier connection-level shedding.
