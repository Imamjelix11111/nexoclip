# Task 16 Canonical Report — durable canvas persistence status

Date: 2026-09-08
Plan source: `docs/superpowers/plans/2026-09-08-spite-realtime-crdt-canvas.md`
Brief source: `.superpowers/sdd/2026-09-08-spite-realtime-crdt-canvas/task-16-brief.md`

## Scope executed

Implemented Task 16 only:
- finished the toolbar interface cutover from legacy `saveStatus` to realtime `persistenceStatus`
- wired read-only state from runtime status into the canvas workspace
- disabled client-side document mutations while leaving Awareness/presence publishing intact
- removed the legacy browser autosave hook after confirming it had no remaining callers
- added focused runtime-status/read-only tests

Locked invariants preserved:
- Yjs remains the authoritative durable source of truth
- toolbar shows “Saved” only after durable `PERSISTED`
- `READ_ONLY` blocks client document mutations without disabling presence/awareness
- no Task 15 report content was retained from the timed-out overwrite attempt; canonical Task 15 report was restored

## What changed

### 1. Toolbar now consumes canonical runtime persistence state

`nexoclip-app/services/spite/components/canvas/canvas-toolbar.tsx` now:
- accepts `persistenceStatus: ProjectRuntimeState` instead of the old `saveStatus`
- derives the visible badge through `getCanvasSaveIndicator(...)`
- shows distinct states for `Pending`, `Saving`, `Saved`, `Degraded`, and `Read-only`
- keeps project-name editing blocked when the workspace is read-only

### 2. Runtime UI helpers centralize status semantics

Added `nexoclip-app/services/spite/lib/canvas-runtime-ui.ts` with:
- `getCanvasSaveIndicator(...)` for canonical toolbar labeling
- `getCanvasRuntimeCapabilities(...)` for read-only/presence capability checks
- `guardCanvasRuntimeControls(...)` to no-op document commands, undo, and redo when runtime status is `READ_ONLY`

### 3. Workspace now respects read-only mutation boundaries

`nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx` now:
- derives `readOnly` from realtime `persistenceStatus`
- passes `persistenceStatus` and `readOnly` into `CanvasToolbar`
- uses guarded realtime commands for workspace mutations and collaboration context
- early-returns from document-mutation entry points in read-only mode, including:
  - node/edge durable changes
  - connect/add/delete/duplicate/scene mutations
  - drop/paste/upload-created node mutations
  - clipboard paste insertion
  - project name persistence
- keeps awareness handlers, cursor publishing, selection mirroring, and presence overlay active
- disables direct graph mutation affordances with `nodesDraggable={false}` / `nodesConnectable={false}` in read-only mode and disables toolbar undo/redo buttons visually

### 4. Collaboration context inherits read-only guards

`nexoclip-app/services/spite/components/canvas/canvas-collaboration.tsx` now wraps the realtime command bundle with the same runtime guard before exposing helper APIs to node/edge children, so child-initiated Yjs mutations no-op under `READ_ONLY`.

### 5. Legacy autosave hook removed

Deleted `nexoclip-app/services/spite/hooks/use-canvas-auto-save.ts` after confirming `useCanvasAutoSave` had no remaining callers anywhere under `nexoclip-app/services/spite`.

## TDD evidence

RED:
- extended `nexoclip-app/services/spite/lib/canvas-runtime-ui.test.ts` with a failing read-only-controls test
- ran the focused test file before implementing the runtime control guard
- observed the expected failure: `guardCanvasRuntimeControls is not a function`

GREEN:
- implemented runtime control guarding and workspace/collaboration wiring
- reran the focused test to green
- reran full Spite tests, realtime tests, TypeScript, and production build

## Verification

Commands run successfully at the end:

```bash
rtk npx --prefix nexoclip-app/services/spite tsx --test nexoclip-app/services/spite/lib/canvas-runtime-ui.test.ts
rtk npm --prefix nexoclip-app/services/spite test
rtk npm --prefix nexoclip-app/services/spite run test:realtime
rtk npx --prefix nexoclip-app/services/spite tsc -p nexoclip-app/services/spite/tsconfig.json --noEmit
rtk npm --prefix nexoclip-app/services/spite run build
```

Results:
- focused Task 16 suite passed (`4` passed, `0` failed)
- full Spite lib suite passed (`68` passed, `0` failed)
- realtime suite passed (`81` passed, `5` skipped, `0` failed)
- TypeScript passed (`0` errors)
- production build completed successfully

## Files changed

Added:
- `nexoclip-app/services/spite/lib/canvas-runtime-ui.ts`
- `nexoclip-app/services/spite/lib/canvas-runtime-ui.test.ts`
- `.superpowers/sdd/2026-09-08-spite-realtime-crdt-canvas/task-16-report.md`

Modified:
- `nexoclip-app/services/spite/components/canvas/canvas-collaboration.tsx`
- `nexoclip-app/services/spite/components/canvas/canvas-toolbar.tsx`
- `nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx`

Deleted:
- `nexoclip-app/services/spite/hooks/use-canvas-auto-save.ts`

## Concerns

- Read-only mutation blocking is now enforced for workspace entry points and collaboration helpers, but many node UIs still render their ordinary controls; those actions now no-op instead of mutating the document. A later UX pass could surface clearer disabled states inside node chrome.
- One aggregate verification run saw a transient failure in `realtime/auth.test.ts`; rerunning that file and the full realtime suite passed cleanly, so I did not change unrelated auth code in Task 16.

## Task 16 Round 1 Retry (option 1 only)

Applied only the approved option-1 hardening after rollback of uncommitted drift into Task 17:
- introduced a stable invocation-time runtime guard in `canvas-runtime-ui.ts` (`createInvocationTimeRuntimeControls`) that checks the **current** status ref on every command/undo/redo call
- reused that same invocation-time guard in both:
  - `nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx`
  - `nexoclip-app/services/spite/components/canvas/canvas-collaboration.tsx`
- ensured previously captured command references no-op immediately after status flips to `READ_ONLY`, including captured `batch(...)` invocations
- updated drag/drop handling so recognized payloads call `preventDefault()` even in read-only mode, then no-op mutation behavior while read-only
- hardened project-name debounce save to re-check current mutation allowance at timeout fire-time, and to clear pending debounce work when entering `READ_ONLY` and on unmount
- removed stale autosave wording in workspace scene-delete comments

TDD for retry:
- added failing-first regression test in `canvas-runtime-ui.test.ts`:
  - `captured runtime controls re-check READ_ONLY at invocation time (including batch)`
- observed RED before implementation:
  - `TypeError: createInvocationTimeRuntimeControls is not a function`
- implemented minimal fix, then verified GREEN

Retry verification results:
- focused runtime-ui suite: `5` passed, `0` failed
- full Spite suite: `69` passed, `0` failed
- realtime suite: `81` passed, `5` skipped, `0` failed
- TypeScript: clean (`tsc --noEmit`)

No server routes, realtime server core files, or generation files were modified in this retry.
