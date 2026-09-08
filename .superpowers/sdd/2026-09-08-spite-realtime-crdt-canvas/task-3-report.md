# Task 3 Report — Add Durable Neon Schema

## Scope
Implemented only Task 3 from `.superpowers/sdd/2026-09-08-spite-realtime-crdt-canvas/task-3-brief.md`.

## Files Modified
- `nexoclip-app/services/spite/database-setup.sql`

## Files Created
- `nexoclip-app/services/spite/lib/realtime/schema.test.ts`
- `nexoclip-app/services/spite/scripts/migrate-realtime.mjs`

## Implemented Schema Contract
Added idempotent realtime persistence/auth tables with locked semantics:

- `canvas_yjs_documents`
  - `project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE`
  - `snapshot bytea`
  - `snapshot_seq bigint NOT NULL DEFAULT 0`
  - `durable_seq bigint NOT NULL DEFAULT 0`
  - `projected_seq bigint NOT NULL DEFAULT 0`
  - `schema_version integer NOT NULL DEFAULT 1`
  - `updated_at timestamptz NOT NULL DEFAULT now()`
  - `CHECK (snapshot_seq <= durable_seq)`
  - `CHECK (projected_seq <= durable_seq)`

- `canvas_yjs_updates`
  - `project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE`
  - `seq bigint NOT NULL`
  - `update_data bytea NOT NULL`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `PRIMARY KEY (project_id, seq)`

- `canvas_auth_nonces`
  - `nonce text PRIMARY KEY`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `expires_at timestamptz NOT NULL`
  - cleanup index: `idx_canvas_auth_nonces_expires_at`

No cross-database user FK was added.

## Migration Runner
Added `scripts/migrate-realtime.mjs`:
- requires `DATABASE_URL`
- reads `database-setup.sql`
- executes full SQL via Neon `Pool`
- fails closed with nonzero exit on any error
- always closes pool in `finally`

## TDD Evidence

### RED
1. Wrote schema contract tests in `lib/realtime/schema.test.ts` first.
2. Ran:
   - `cd nexoclip-app/services/spite && rtk npx pnpm exec tsx --test lib/realtime/schema.test.ts`
3. Result: **FAIL** (3/4 failing) due missing realtime tables.

### GREEN
1. Added schema blocks and nonce expiry index to `database-setup.sql`.
2. Added migration runner `scripts/migrate-realtime.mjs`.
3. Re-ran focused test:
   - `cd nexoclip-app/services/spite && rtk npx pnpm exec tsx --test lib/realtime/schema.test.ts`
4. Result: **PASS** (4/4).

### Additional verification
- Ran:
  - `cd nexoclip-app/services/spite && rtk npx pnpm test`
- Result: **PASS** (25/25).

## Notes / Concerns
- The migration runner intentionally does not auto-load `.env.local`; it fails closed unless `DATABASE_URL` is explicitly present in the process environment.
- Existing Node runtime warning about localStorage in test output is unchanged and non-blocking.

## Fix Round 1 — Reviewer Findings
Addressed reviewer items for Task 3:

### IMPORTANT: Explicit transaction semantics in migration runner
- Refactored `scripts/migrate-realtime.mjs` to export `applyRealtimeSchema()` with explicit transaction flow on a checked-out client:
  - `BEGIN`
  - `SET LOCAL lock_timeout = '5s'` (transaction setup SQL)
  - execute `database-setup.sql`
  - `COMMIT`
- On any error, runner now explicitly issues `ROLLBACK`, then rethrows original error.
- Runner always releases client and closes pool in `finally`.
- Script now avoids side effects on import (only runs `main()` when executed directly), enabling unit tests.

### IMPORTANT: Added failing test before implementation (TDD)
- Created `lib/realtime/migrate-realtime.test.ts` with two contract tests:
  1. success path asserts exact query order and cleanup
  2. error path asserts `ROLLBACK` plus cleanup

### MINOR: seq domain contract (`durable_seq + 1` semantics)
- Added `CHECK (seq > 0)` to `canvas_yjs_updates` in `database-setup.sql`.
- Added schema contract assertion in `lib/realtime/schema.test.ts` for `check (seq > 0)`.
- This is consistent with per-project append semantics where first durable update sequence is `1` (next after `durable_seq=0`).

### MINOR: String schema tests not executing DB
- Deferred as requested; Task 4 introduces opt-in Neon integration coverage.

## Fix Round 1 — Test Evidence
### RED
Command:
- `cd nexoclip-app/services/spite && rtk npx pnpm exec tsx --test lib/realtime/schema.test.ts lib/realtime/migrate-realtime.test.ts`

Observed failures:
- `lib/realtime/migrate-realtime.test.ts` failed because script executed on import and required `DATABASE_URL`.
- `database-setup defines append-only canvas_yjs_updates ordering per project` failed for missing `check (seq > 0)`.

### GREEN
Command:
- `cd nexoclip-app/services/spite && rtk npx pnpm exec tsx --test lib/realtime/schema.test.ts lib/realtime/migrate-realtime.test.ts`

Result:
- **PASS** (6/6)

### Additional verification
Command:
- `cd nexoclip-app/services/spite && rtk npx pnpm run test:realtime`

Result:
- **PASS** (18/18)

## Fix Round 2 — Relative CLI guard
Addressed the direct-execution guard bug in `scripts/migrate-realtime.mjs`.

### Root cause
- `fileURLToPath(import.meta.url)` is absolute.
- `process.argv[1]` can be a relative CLI path such as `scripts/migrate-realtime.mjs`.
- Raw equality can therefore return `false` even for direct execution, so `main()` is skipped.

### Code change
- Exported `isDirectExecution()` for deterministic coverage.
- Switched the guard to compare `fileURLToPath(moduleUrl)` against `resolve(argv1)`.
- Left `main()` behavior unchanged.

## Fix Round 2 — Exact test evidence
### RED
Command:
- `cd nexoclip-app/services/spite && rtk npx pnpm exec tsx --test lib/realtime/migrate-realtime.test.ts`

Observed output:
```text
✖ isDirectExecution treats relative CLI paths as direct execution (0.800084ms)
✔ applyRealtimeSchema wraps schema execution in explicit transaction and releases client (0.790416ms)
✔ applyRealtimeSchema rolls back on error and still releases client/pool (0.338292ms)
ℹ tests 3
ℹ pass 2
ℹ fail 1
TypeError: (0 , import_migrate_realtime.isDirectExecution) is not a function
```

### GREEN
Command:
- `cd nexoclip-app/services/spite && rtk npx pnpm exec tsx --test lib/realtime/schema.test.ts lib/realtime/migrate-realtime.test.ts`

Observed output:
```text
✔ isDirectExecution treats relative CLI paths as direct execution (0.548709ms)
✔ applyRealtimeSchema wraps schema execution in explicit transaction and releases client (0.771625ms)
✔ applyRealtimeSchema rolls back on error and still releases client/pool (0.319708ms)
✔ database-setup defines durable canvas_yjs_documents table with sequence constraints (0.758958ms)
✔ database-setup defines append-only canvas_yjs_updates ordering per project (0.076042ms)
✔ database-setup defines replay-protected auth nonce table with expiry index (0.080209ms)
✔ realtime schema never introduces cross-database user foreign keys (0.107041ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
```
