# Task 18 Canonical Report — lock legacy canvas APIs to projection-only semantics

Date: 2026-09-09
Plan source: `docs/superpowers/plans/2026-09-08-spite-realtime-crdt-canvas.md`
Brief source: `.superpowers/sdd/2026-09-08-spite-realtime-crdt-canvas/task-18-brief.md`

## Scope executed

Implemented Task 18 only:
- converted legacy `projects/[projectId]/canvas` POST into a hard `410 Gone` compatibility endpoint after auth + ownership validation
- removed the old direct save pipeline from that route, including whole-array projection rewrites and related dead save helpers/imports
- kept canvas GET as the legacy projection read, but added a nonbreaking `source: 'projection'` payload field and `X-Canvas-Source: projection` header
- kept snapshot restore on the Task 17 internal realtime replace path and added contract coverage that restore does not touch projection tables directly
- added focused route contract tests for the legacy canvas route and snapshot restore path

Locked invariants preserved:
- legacy canvas GET remains a projection-backed compatibility read
- legacy canvas POST no longer parses request bodies or writes canonical/projection canvas state
- snapshot restore still enters the authoritative Yjs replacement path instead of direct compatibility-table restore writes
- internal replace request markers remain in place, but GET now advertises projection-source compatibility independently

## What changed

### 1. Legacy canvas POST is now gone

Modified:
- `nexoclip-app/services/spite/app/api/projects/[projectId]/canvas/route.ts`

Behavior:
- authenticates the caller
- validates project ownership
- returns `410` with `{ error: 'Canvas save endpoint is gone; use realtime sync' }`
- does not parse the POST body
- does not open SQL transactions
- does not issue direct `canvas_nodes`, `canvas_edges`, project scene metadata, snapshot, or asset-reconcile writes from this route

### 2. Legacy canvas GET now self-identifies as projection output

Modified:
- `nexoclip-app/services/spite/app/api/projects/[projectId]/canvas/route.ts`

Behavior:
- still reads compatibility projection tables plus project scene metadata
- now returns `source: 'projection'` in the JSON payload
- now sets `X-Canvas-Source: projection` on the response headers
- keeps existing response fields (`nodes`, `edges`, `scenes`, `activeSceneId`) unchanged for compatibility callers

### 3. Snapshot restore is contract-locked to authoritative replace

Added:
- `nexoclip-app/services/spite/lib/task-18-legacy-canvas-routes.test.ts`

Coverage:
- restore still reads the requested snapshot
- restore still snapshots current state into `canvas_snapshots` before replacing
- restore calls `replaceDocument(...)`
- restore fails the contract test if it attempts direct `canvas_nodes` or `canvas_edges` SQL

## TDD evidence

RED:
- added `nexoclip-app/services/spite/lib/task-18-legacy-canvas-routes.test.ts`
- ran the focused suite first
- observed the expected failures:
  - canvas GET had no projection source header
  - canvas GET had no `source: 'projection'` marker
  - legacy canvas POST still attempted body parsing and did not return `410 Gone`

GREEN:
- removed the old legacy canvas save implementation from `canvas/route.ts`
- added the GET response marker/header
- reran the focused suite to green
- reran the full Spite lib suite, realtime suite, TypeScript, and production build

## Verification

Commands run successfully at the end:

```bash
rtk proxy bash -lc 'cd nexoclip-app/services/spite && npx tsx --test lib/task-18-legacy-canvas-routes.test.ts'
rtk npm --prefix nexoclip-app/services/spite test
rtk proxy bash -lc 'cd nexoclip-app/services/spite && npx tsx --test --test-force-exit "lib/realtime/**/*.test.ts" "realtime/**/*.test.ts"'
rtk npx --prefix nexoclip-app/services/spite tsc -p nexoclip-app/services/spite/tsconfig.json --noEmit
rtk npm --prefix nexoclip-app/services/spite run build
```

Additional contract evidence:

```bash
rtk grep -n "DELETE FROM canvas_nodes|INSERT INTO canvas_nodes|DELETE FROM canvas_edges|INSERT INTO canvas_edges|UPDATE projects\\s+SET updatedat|canvas_nodes|canvas_edges" nexoclip-app/services/spite/app/api/projects/[projectId]/canvas/route.ts nexoclip-app/services/spite/app/api/projects/[projectId]/canvas/snapshots/route.ts
```

The grep returned no matches in those route files.

Results:
- focused Task 18 suite passed (`3` passed, `0` failed)
- full Spite lib suite passed (`81` passed, `0` failed)
- realtime suite passed (`89` passed, `5` skipped because `SPITE_TEST_DATABASE_URL` is unset, `0` failed)
- TypeScript passed (`0` errors)
- production build completed successfully

## Files changed

Added:
- `nexoclip-app/services/spite/lib/task-18-legacy-canvas-routes.test.ts`
- `.superpowers/sdd/2026-09-08-spite-realtime-crdt-canvas/task-18-report.md`

Modified:
- `nexoclip-app/services/spite/app/api/projects/[projectId]/canvas/route.ts`

## Notes

- `app/api/projects/[projectId]/canvas/snapshots/route.ts` did not require a production-code change because Task 17 had already moved restore through `replaceDocument(...)`; Task 18 adds an explicit contract test so later edits cannot silently reintroduce direct projection restore writes.
