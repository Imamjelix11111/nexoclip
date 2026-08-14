# Task 1 Report — ViMax durable job admission

## Status

Implemented and committed the Task 1 durable ViMax job-admission scope.

## Requirements delivered

- Added migration `018_vimax_generation_admission.sql`.
  - Replaces the original inline PostgreSQL `generation_jobs_kind_check` (the name automatically assigned to the inline `kind` check in migration 006) after dropping it conditionally.
  - Allows only `image`, `vimax_narrative_planning`, `vimax_novel_planning`, and `vimax_render_video`.
  - Seeds version-1 normal `pricing_rules` entries for all three ViMax operations at `0.000000` credits, with `ON CONFLICT DO NOTHING` to preserve configured values in existing environments.
- Added narrow ViMax validation.
  - Permits only the three policy-approved durable kinds.
  - Requires `sessionId` matching `^[A-Za-z0-9][A-Za-z0-9-]{0,95}$`.
  - Accepts only a plain-object `input` payload and JSON-clones it.
  - Does not accept workspace roots or credentials; persistence uses canonical, non-null prompts and model `vimax`.
- Added `createVimaxGenerationJobWithReservation`.
  - Mirrors the established image-admission transaction without refactoring image flow: begin, idempotency lookup, normal pricing lookup, limits, credit-account lock, debit (including zero), `generation_reservation` ledger record, durable job insert, commit/rollback.
  - A repeated workspace/idempotency-key request returns the existing job before a second ledger insert.
- Added `createVimaxGeneration` repository insert using explicit ViMax kind/provider/session columns.
- Included `vimax_session_id`, `provider`, `provider_request_id`, and `progress` in repository job projections, so reads expose the Task 1/previous ViMax fields.

## TDD evidence

### RED

1. Migration test, before migration existed:

```text
cd nexoclip-app && rtk node --test tests/db/vimaxGenerationAdmissionMigration.test.mjs
FAIL — ENOENT for 018_vimax_generation_admission.sql
```

2. ViMax validation test, before service export existed:

```text
cd nexoclip-app && rtk node --test tests/generations/generationService.test.mjs
FAIL — validateVimaxGenerationInput is not exported
```

3. Repository/reservation tests, before functions existed:

```text
cd nexoclip-app && rtk node --test tests/generations/generationRepository.test.mjs tests/generations/generationReservation.test.mjs
FAIL — createVimaxGeneration and createVimaxGenerationJobWithReservation are not exported
```

### GREEN

```text
cd nexoclip-app && rtk node --test tests/db/vimaxGenerationAdmissionMigration.test.mjs tests/generations/generationRepository.test.mjs tests/generations/generationReservation.test.mjs tests/generations/generationService.test.mjs
PASS — 15 tests, 0 failures
```

Fresh final execution had the same result: 15 tests passed, 0 failed.

`rtk git diff --check` also passed for all Task 1 files.

## Files committed

- `nexoclip-app/src/db/migrations/018_vimax_generation_admission.sql`
- `nexoclip-app/src/repositories/generationRepository.js`
- `nexoclip-app/src/services/generationService.js`
- `nexoclip-app/tests/db/vimaxGenerationAdmissionMigration.test.mjs`
- `nexoclip-app/tests/generations/generationRepository.test.mjs`
- `nexoclip-app/tests/generations/generationReservation.test.mjs`
- `nexoclip-app/tests/generations/generationService.test.mjs`

## Commit

`feat: admit durable ViMax generation jobs`

SHA: `2447607`.

## Concerns

- Node emits the pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning during these ESM tests. No Task 1 change was made to package module configuration.
- The migration test checks SQL structure rather than applying migrations to a live PostgreSQL instance. The constraint name was verified from PostgreSQL’s inline-check naming convention and migration 006’s table/column names; migration uses `DROP CONSTRAINT IF EXISTS` for current/fresh history compatibility.
- Existing unrelated dirty files were intentionally not staged or modified.

## Follow-up fix evidence — zero-cost/no-ledger policy

- ViMax admission now treats a `0.000000` estimate as a no-ledger reservation: it does not create/lock a credit account, does not write `credit_ledger`, and persists `reservation_ledger_id = NULL`. This preserves the existing `credit_ledger.amount <> 0` invariant and avoids zero-value settlement entries.
- The ViMax DTO is closed. Only `kind`, `sessionId`, `input`, `idempotencyKey`, `projectId`, and `pricingVersion` are accepted; `workspaceId`, `tenantRoot`, credentials, and arbitrary `parameters` are rejected.
- A `23505` during admission now rolls back, re-reads the workspace/idempotency job, and returns it when present. Other database failures are rethrown.

### Follow-up RED

```text
cd nexoclip-app && rtk node --test tests/generations/generationService.test.mjs
FAIL — closed-DTO test: Missing expected exception

cd nexoclip-app && rtk node --test tests/generations/generationReservation.test.mjs
FAIL — concurrent idempotency test: Error: duplicate (code 23505)
```

### Follow-up GREEN

```text
cd nexoclip-app && rtk node --test tests/db/vimaxGenerationAdmissionMigration.test.mjs tests/db/vimaxGenerationAdmissionIntegration.test.mjs tests/generations/generationRepository.test.mjs tests/generations/generationReservation.test.mjs tests/generations/generationService.test.mjs
PASS — 17 passed, 0 failed; conditional PostgreSQL integration test skipped because DATABASE_URL is unset.
```

- Added `tests/db/vimaxGenerationAdmissionIntegration.test.mjs`: when `DATABASE_URL` is configured, it resets the schema, applies migrations, creates a workspace, admits a zero-cost ViMax job, and asserts `queued`, `reservation_ledger_id = NULL`, and no ledger entries.

## Re-review 1 follow-up — workspace session boundary and zero-cost settlement

- The admission DTO deliberately remains syntax-only for `sessionId`; it accepts only an identifier, never a filesystem path or tenant root.
- The runtime is now the ownership boundary: `RuntimeExecutor` derives the tenant workspace root from the worker-supplied `workspace_id`, constructs `SessionIndex` below that root, and rejects direct execution unless `SessionIndex.get(session_id)` finds a record in that workspace-local index. It raises `ValueError("Unknown workspace session")` before adapter construction/execution.
- The FastAPI runtime maps this invalid execution request to HTTP 400 without exposing filesystem/session details. The existing Node runtime client classifies HTTP 400 as `RUNTIME_REQUEST_FAILED`, which is non-retryable. This changes previously committed Task 2 runtime code solely to enforce the missing workspace-local session authorization boundary.
- Added `settleUnreservedGeneration` service/repository transition. It locks the workspace-scoped job and changes only pending `reservation_ledger_id IS NULL` terminal jobs: `succeeded → captured`, `failed → released`. It is idempotent and performs no credit-account or credit-ledger writes.
- The generic generation worker now invokes that no-ledger transition after a successful zero-cost job or a terminal zero-cost failure. Reserved jobs retain the existing capture/release path.
- The integration test now requires explicit `NEXOCLIP_TEST_DATABASE_URL` (with a skip reason documenting the dedicated test database requirement), assigns it to the migration pool only for the test, runs migrations without `DROP SCHEMA`, and asserts the zero-cost `queued`/`pending`/null-reservation/no-ledger shape.

### Re-review TDD evidence

#### RED

```text
cd nexoclip-app && rtk node --test tests/credits/generationSettlement.test.mjs tests/queue/generationWorkerState.test.mjs
FAIL — settleUnreservedGeneration export missing; worker did not invoke no-ledger settlement on success or terminal failure.
```

#### GREEN / verification

```text
cd nexoclip-app && rtk node --test tests/db/vimaxGenerationAdmissionMigration.test.mjs tests/db/vimaxGenerationAdmissionIntegration.test.mjs tests/generations/generationRepository.test.mjs tests/generations/generationReservation.test.mjs tests/generations/generationService.test.mjs tests/credits/generationSettlement.test.mjs tests/queue/generationWorker.test.mjs tests/queue/generationWorkerState.test.mjs tests/queue/generationWorkerOutput.test.mjs tests/queue/storyboardRuntimeClient.test.mjs tests/queue/storyboardWorker.test.mjs
PASS — 41 passed, 0 failed, 1 skipped.
```

```text
cd nexoclip-app/services/vimax && rtk uv run pytest tests/test_runtime_api.py -q
PASS — 10 passed, 1 pre-existing Starlette/httpx deprecation warning.
```

The PostgreSQL integration test was skipped because `NEXOCLIP_TEST_DATABASE_URL` was not configured. No live integration run is claimed.

## Re-review 2 follow-up — terminal no-ledger recovery and runtime errors

- Added `recoverUnreservedGenerations`, which scans only terminal (`succeeded`/`failed`), pending, no-reservation jobs and delegates to the existing locked, idempotent settlement transition. It makes no credit-account or ledger writes.
- Generation workers run this recovery before dequeuing provider work. A failed immediate settlement leaves the already-terminal job pending; it is recovered on worker startup without claiming the job or invoking its provider handler. Terminal settlement exceptions no longer enter the provider-failure transition path.
- Added `InvalidRuntimeRequest`, used only for syntax/session-boundary validation. FastAPI maps only this exception to 400. Adapter/runtime `ValueError`s now remain 500 responses, which the Node runtime client classifies as retryable `PROVIDER_UNAVAILABLE` failures.

### Re-review 2 RED

```text
cd nexoclip-app && rtk node --test tests/credits/generationSettlement.test.mjs tests/queue/generationWorkerState.test.mjs
FAIL — missing `recoverUnreservedGenerations`; worker startup did not invoke recovery.

cd nexoclip-app/services/vimax && rtk uv run pytest tests/test_runtime_api.py -q
FAIL — adapter-raised ValueError returned HTTP 400 rather than HTTP 500.
```

### Re-review 2 final verification

```text
cd nexoclip-app && rtk node --test tests/credits/generationSettlement.test.mjs tests/queue/generationWorker.test.mjs tests/queue/generationWorkerState.test.mjs tests/queue/generationWorkerOutput.test.mjs tests/queue/storyboardRuntimeClient.test.mjs tests/queue/storyboardWorker.test.mjs
PASS — 30 passed, 0 failed.

cd nexoclip-app/services/vimax && rtk uv run pytest tests/test_runtime_api.py -q
PASS — 11 passed, 1 existing Starlette/httpx deprecation warning.

rtk git diff --check
PASS.
```

### Re-review 2 concerns

- Node emits the pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning during ESM tests.
- Python emits the existing Starlette/httpx `TestClient` deprecation warning.
- The dedicated PostgreSQL integration test remains unrun without `NEXOCLIP_TEST_DATABASE_URL`.
