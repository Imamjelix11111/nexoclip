# Task 14 Canonical Report — client Awareness/presence UI

Date: 2026-09-08
Plan source: `docs/superpowers/plans/2026-09-08-spite-realtime-crdt-canvas.md`
Brief source: `.superpowers/sdd/2026-09-08-spite-realtime-crdt-canvas/task-14-brief.md`

## Scope executed

Implemented Task 14 only:
- presence utilities and focused tests in `nexoclip-app/services/spite/lib/realtime/presence.ts` and `presence.test.ts`
- awareness overlay renderer in `nexoclip-app/services/spite/components/canvas/realtime-presence.tsx`
- canvas workspace wiring for ephemeral awareness publishing and remote lock UX in `canvas-workspace.tsx`
- minimal `useRealtimeCanvas` awareness API exposure for local presence writes

Locked invariants preserved:
- presence stays ephemeral in Awareness only
- no cursor, selection, editing, or lock data is written into Y.Doc persistence
- server-owned participant sanitization, `Guest N` naming, and authoritative lock expiry remain the source of truth
- legacy REST hydration and autosave remain in place; Task 15’s Yjs mutation migration was not pulled into this task

## What changed

### 1. Presence utilities

Added a small client-side presence module with:
- stable per-tab participant hint storage in `sessionStorage`
- deterministic participant colors derived from the participant hint
- a presence controller that seeds local Awareness, throttles cursor writes to `48 ms`, publishes selection/editing state, and runs drag lock start/heartbeat/stop
- remote presence projection that filters expired locks from server `expiresAt` timestamps while keeping the participant visible

### 2. Hook seam for Awareness publishing

Extended `useRealtimeCanvas(projectId)` to expose the provider Awareness object alongside peer snapshots so the canvas can publish ephemeral local presence without reaching into private internals.

### 3. Canvas workspace + renderer

Wired `canvas-workspace.tsx` to:
- create one presence controller for the active tab/session
- publish flow-space cursor positions on pointer movement
- clear cursor on leave
- publish selected node ids as selection awareness
- infer editing state from focused `input`, `textarea`, and `contenteditable` elements inside React Flow nodes
- start drag locks on node drag start and stop them on drag stop
- derive active remote locks from server time and mark locked nodes non-draggable
- render remote cursors, `Guest` labels, selection boxes, editing hints, and drag-lock hints in a dedicated overlay component

## TDD evidence

RED:
- created `lib/realtime/presence.test.ts`
- ran the focused test before implementation
- observed the expected failure: missing `./presence`

GREEN:
- implemented the presence module, overlay, hook seam, and workspace wiring
- reran the focused suite to green
- reran TypeScript and the broader Spite suite after the workspace integration

## Verification

Commands run successfully at the end:

```bash
cd nexoclip-app/services/spite && rtk npx --yes tsx --test lib/realtime/presence.test.ts
cd nexoclip-app/services/spite && rtk tsc --noEmit
cd nexoclip-app/services/spite && rtk npx --yes tsx --test "lib/**/*.test.ts" "realtime/**/*.test.ts"
```

Results:
- focused Task 14 suite passed (`6` passed, `0` failed)
- TypeScript passed (`0` errors)
- full Spite suite passed (`103` passed, `5` skipped because `SPITE_TEST_DATABASE_URL` is unset, `0` failed)

## Files changed

Added:
- `nexoclip-app/services/spite/lib/realtime/presence.ts`
- `nexoclip-app/services/spite/lib/realtime/presence.test.ts`
- `nexoclip-app/services/spite/components/canvas/realtime-presence.tsx`
- `.superpowers/sdd/2026-09-08-spite-realtime-crdt-canvas/task-14-report.md`

Modified:
- `nexoclip-app/services/spite/hooks/use-realtime-canvas.ts`
- `nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx`

## Concerns

- The presence renderer is covered by utility tests plus TypeScript, not by a browser-rendered component test. The highest-risk logic paths are verified, but DOM placement is still integration-level behavior.
- Selection overlays use measured node dimensions when React Flow has them and fixed fallbacks otherwise, so hints can be slightly approximate during first paint before node measurement settles.
- Because Task 15 is still pending, durable canvas mutations remain on the existing local-state/autosave path while awareness alone uses realtime transport.
