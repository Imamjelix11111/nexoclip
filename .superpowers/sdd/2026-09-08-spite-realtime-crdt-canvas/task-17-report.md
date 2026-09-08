# Task 17 Canonical Report — server-side canvas writers through Yjs

Date: 2026-09-08
Plan source: `docs/superpowers/plans/2026-09-08-spite-realtime-crdt-canvas.md`
Brief source: `.superpowers/sdd/2026-09-08-spite-realtime-crdt-canvas/task-17-brief.md`

## Scope executed

Implemented Task 17 only:
- added a private authenticated realtime document endpoint for trusted server-side export and mutation
- routed generation completion, recovery cleanup, snapshot restore, and project duplication through authoritative Yjs mutations instead of direct `canvas_nodes`/`canvas_edges` writes
- hardened asset deletion against projection lag by consulting authoritative Yjs state when projection sequence lags durable sequence
- added focused Task 17 tests plus realtime server endpoint coverage
- updated impacted legacy security tests to match the new authoritative-write path

Locked invariants preserved:
- server-side canvas mutations now flow through HTTP auth/authorization → realtime document mutation → incremental durable update append → async projection scheduling
- routine server writes patch Yjs node data instead of bulk-rewriting projection tables
- restore/duplicate remain whole-document operations, but now enter the same Yjs pipeline as explicit document replacement
- destructive asset removal no longer trusts stale projection rows when authoritative state may be ahead

## What changed

### 1. Private realtime document API

Added `nexoclip-app/services/spite/lib/realtime/internal-client.ts` and extended `nexoclip-app/services/spite/realtime/server.ts` with `POST /internal/document`.

The endpoint:
- reuses existing HMAC + nonce + ownership authorization
- supports:
  - `export-document`
  - `patch-node-data`
  - `replace-document`
- mutates an active room document when present, otherwise loads/imports the durable Yjs document and applies the same mutation through a temporary runtime
- waits for runtime flush before returning mutation success so the caller only proceeds after durable append commit

### 2. Generation completion and recovery cleanup now patch Yjs

`nexoclip-app/services/spite/lib/r2-upload.ts` now exports `createAttachGeneratedMediaToNode(...)` and routes completion updates through the internal realtime client.

`generate/submit`, `generate/status`, and `generate/recover` now:
- keep using existing auth/ownership checks
- pass the authenticated user id into trusted Yjs mutations
- clear pending flags and set output/status fields through authoritative node-data patch operations
- stop issuing direct `UPDATE canvas_nodes ...` writes for these flows

### 3. Snapshot restore and duplication now use authoritative document replacement

`canvas/snapshots` restore now:
- exports the current authoritative Yjs document before restore for the pre-restore backup snapshot
- preserves current scene metadata
- replaces the document through realtime `replace-document` instead of deleting/reinserting projection rows

`projects/[projectId]/duplicate` now:
- exports the source project’s authoritative document through realtime
- creates the new project row
- initializes the new project’s authoritative Yjs document via `replace-document`
- stops cloning `canvas_nodes` / `canvas_edges` directly as canonical state

### 4. Projection-lag safety for destructive asset deletion

`app/api/assets/[assetId]/route.ts` now:
- checks `canvas_yjs_documents.durable_seq` vs `projected_seq`
- uses projection-table lookups only when projection is current
- falls back to authoritative Yjs export when projection lags or no durable row is present
- keeps the asset protected if authoritative document state still references it

`app/api/projects/[projectId]/route.ts` now also preloads authoritative references from lagging sibling projects owned by the same user before deciding whether shared generation/upload media can be deleted during project teardown.

## TDD evidence

RED:
- added `nexoclip-app/services/spite/lib/task-17-server-writers.test.ts`
- extended `nexoclip-app/services/spite/realtime/server-core.test.ts`
- ran the focused suites before implementation
- observed expected failures including:
  - `createAttachGeneratedMediaToNode is not a function`
  - missing `/internal/document` behavior (non-JSON 404 body)
  - snapshot/recovery/asset tests still hitting direct projection-table mutation paths

GREEN:
- implemented the internal realtime client + server endpoint
- rerouted Task 17 server writers to authoritative Yjs mutations
- reran focused tests to green
- reran full Spite lib suite, realtime suite, TypeScript, and production build

## Verification

Commands run successfully at the end:

```bash
rtk proxy bash -lc 'cd nexoclip-app/services/spite && npx tsx --test lib/task-17-server-writers.test.ts'
rtk proxy bash -lc 'cd nexoclip-app/services/spite && npx tsx --test --test-force-exit "lib/realtime/**/*.test.ts" "realtime/**/*.test.ts"'
rtk npm --prefix nexoclip-app/services/spite test
rtk npx --prefix nexoclip-app/services/spite tsc -p nexoclip-app/services/spite/tsconfig.json --noEmit
rtk npm --prefix nexoclip-app/services/spite run build
```

Results:
- focused Task 17 suite passed (`5` passed, `0` failed)
- realtime suite passed (`82` passed, `5` skipped, `0` failed)
- full Spite lib suite passed (`74` passed, `0` failed)
- TypeScript passed (`0` errors)
- production build completed successfully

## Files changed

Added:
- `nexoclip-app/services/spite/lib/realtime/internal-client.ts`
- `nexoclip-app/services/spite/lib/task-17-server-writers.test.ts`
- `.superpowers/sdd/2026-09-08-spite-realtime-crdt-canvas/task-17-report.md`

Modified:
- `nexoclip-app/services/spite/app/api/assets/[assetId]/route.ts`
- `nexoclip-app/services/spite/app/api/generate/recover/route.ts`
- `nexoclip-app/services/spite/app/api/generate/status/route.ts`
- `nexoclip-app/services/spite/app/api/generate/submit/route.ts`
- `nexoclip-app/services/spite/app/api/projects/[projectId]/canvas/snapshots/route.ts`
- `nexoclip-app/services/spite/app/api/projects/[projectId]/duplicate/route.ts`
- `nexoclip-app/services/spite/app/api/projects/[projectId]/route.ts`
- `nexoclip-app/services/spite/lib/r2-upload.ts`
- `nexoclip-app/services/spite/lib/realtime/document.ts`
- `nexoclip-app/services/spite/lib/task-11-security.test.ts`
- `nexoclip-app/services/spite/realtime/server-core.test.ts`
- `nexoclip-app/services/spite/realtime/server.ts`

## Concerns

- The realtime test runner needed `--test-force-exit` for direct CLI verification because the Hocuspocus suite leaves open handles long enough to stall a plain one-shot `tsx --test` process, even though the suite itself passes cleanly.

## Retry Round 1: bind internal document actions into the HMAC

### Problem

`POST /internal/document` originally reused the `/internal/authorize` HMAC envelope but signed only `{ userId, projectId, timestamp, nonce }`.
That meant the caller and project were authenticated, but the action payload itself (`action`, `nodeId`, `set`, `unset`, `projection`) was not bound into the MAC.
A body changed after signing could still be accepted.

### Fix

Modified:
- `nexoclip-app/services/spite/realtime/internal-auth.ts`
- `nexoclip-app/services/spite/lib/realtime/internal-client.ts`
- `nexoclip-app/services/spite/realtime/server.ts`

Behavior:
- internal auth payloads now optionally include `actionDigest`
- `actionDigest` is a SHA-256 digest of a canonicalized JSON form of the signed action body
- internal realtime client signs `{ action, ...body }` for every `/internal/document` request
- realtime server recomputes that digest from the received action payload before nonce insertion / ownership lookup
- tampered action bodies now fail closed with `403` and do not mutate authoritative Yjs state

### Regression coverage added

Modified:
- `nexoclip-app/services/spite/realtime/auth.test.ts`
- `nexoclip-app/services/spite/realtime/server-core.test.ts`

Added failing-first coverage for:
- `verifyCanvasAuthorization binds optional action digests into the signature`
- `private /internal/document rejects action bodies that do not match the signed payload`

Assertions cover:
- changing `actionDigest` invalidates the signature
- a request signed for one action body cannot be replayed with a different `/internal/document` action body
- rejected tampering leaves the authoritative document unchanged

### Verification

Commands run successfully:

```bash
rtk proxy bash -lc 'cd nexoclip-app/services/spite && npx tsx --test --test-force-exit realtime/auth.test.ts realtime/server-core.test.ts'
rtk proxy bash -lc 'cd nexoclip-app/services/spite && npx tsx --test --test-force-exit "lib/**/*.test.ts" "realtime/**/*.test.ts"'
rtk npx --prefix nexoclip-app/services/spite tsc -p nexoclip-app/services/spite/tsconfig.json --noEmit
rtk npm --prefix nexoclip-app/services/spite run build
```

Results:
- focused auth + server-core verification passed (`13` passed, `0` failed)
- full Spite test suite passed (`123` passed, `5` skipped because `SPITE_TEST_DATABASE_URL` is unset, `0` failed)
- TypeScript emitted `0` errors
- production build completed successfully
