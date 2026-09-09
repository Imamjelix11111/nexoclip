# Task 15 Canonical Report — Yjs-authoritative canvas mutation cutover

Date: 2026-09-08
Plan source: `docs/superpowers/plans/2026-09-08-spite-realtime-crdt-canvas.md`
Brief source: `.superpowers/sdd/2026-09-08-spite-realtime-crdt-canvas/task-15-brief.md`

## Scope executed

Implemented Task 15 only:
- cut over `canvas-workspace.tsx` from local durable canvas state to `useRealtimeCanvas()` derived state + Yjs commands
- added a small collaboration context in `components/canvas/canvas-collaboration.tsx` so node/edge children can mutate the authoritative Yjs document without direct React Flow durable setters
- moved durable mutations in the listed node/edge child components to collaboration/Yjs commands
- extended the binding/hook snapshot with `allNodes` / `allEdges` for scene timeline and whole-canvas logic while keeping React Flow render arrays scene-filtered
- added focused durable-mutation coverage in `lib/realtime/react-flow-binding.test.ts`

Locked invariants preserved:
- Yjs remains the authoritative durable source of truth
- React Flow render arrays stay derived UI state
- viewport persistence stays local-only
- no legacy browser `GET /api/projects/:id/canvas` hydration path remains in the workspace
- no local whole-array undo/redo history remains in the workspace
- Task 16 autosave-status cleanup was not expanded beyond the minimum needed for this cutover

## What changed

### 1. Workspace cutover to realtime-derived state

`components/canvas/canvas-workspace.tsx` now:
- consumes `nodes`, `edges`, `allNodes`, `scenes`, `activeSceneId`, `commands`, `undo`, `redo`, and `persistenceStatus` from `useRealtimeCanvas(projectId)`
- removes `useNodesState`, `useEdgesState`, local durable `scenes`, local undo/redo history arrays, `useCanvasAutoSave`, and legacy browser canvas hydration
- routes durable mutations through Yjs commands:
  - drag/resize via `commands.applyNodeChanges()`
  - connect via `commands.connect()`
  - add/delete/duplicate/clipboard/scene delete via Yjs command helpers
  - edge cut/disconnect via `commands.deleteEdge()`
- keeps only selection and viewport as local UI state
- derives toolbar save state from realtime persistence status instead of autosave status

### 2. Collaboration context for child components

Added `components/canvas/canvas-collaboration.tsx` with a provider/hook that exposes:
- authoritative realtime snapshot data
- raw Yjs command bundle
- helper methods for node/edge batch creation/deletion
- partial node-data mutation helper backed by a binding-level `patchNodeData()` merge command
- scene-local shot reassignment helpers

This removed the need for child components to call direct React Flow durable setters while still allowing them to read live render state from React Flow where appropriate.

### 3. Binding/hook support for whole-canvas reads + partial data patches

`lib/realtime/react-flow-binding.ts` and `hooks/use-realtime-canvas.ts` now expose:
- `allNodes` and `allEdges` in addition to the active-scene `nodes` / `edges`
- `patchNodeData(nodeId, patch)` for safe partial `data` merges in the current authoritative Yjs doc

This was necessary because the actual browser canvas still needs whole-canvas knowledge for:
- scene timeline shot derivation
- active-job counting across scenes
- asset cleanup on delete
while React Flow itself should still render only the active-scene projection.

### 4. Durable child mutations moved off React Flow setters

Updated listed child files so durable mutations now flow through collaboration/Yjs commands:
- `connected-inputs.tsx` — disconnect one/all edges
- `edges/scissors-edge.tsx` — edge cut button
- `nodes/comment-node.tsx` — comment text save + delete
- `nodes/sticker-node.tsx` — sticker value save + delete
- `nodes/prompt-node.tsx` — prompt/mentions persistence
- `nodes/reference-node.tsx` — shot assignment/replacement/new-shot + width persistence
- `nodes/compress-node.tsx` — compression result persistence
- `nodes/node-toolbar.tsx` — delete, duplicate, arrange-grid, quick-connect
- `nodes/image-node.tsx` — width, generation completion, pending markers, batch-spawned duplicates/edges, shot assignment, prompt/model settings, rename
- `nodes/video-node.tsx` — generation completion, pending markers, batch-spawned duplicates/edges, thumbnail persistence, shot assignment, prompt/model settings, rename

### 5. Local mirrors audited so remote updates do not get silently overwritten

Added prop-to-local-state sync paths in prompt/comment/sticker/reference/image/video/compress nodes so remote Yjs updates refresh the UI instead of leaving stale local mirrors that later overwrite the authoritative document.

## TDD evidence

RED:
- expanded `lib/realtime/react-flow-binding.test.ts` with a durable-mutation cutover test covering drag, resize, add, connect, delete, duplicate, clipboard, scene delete, generation data patch, shot assignment, disconnect, and edge cut
- ran the focused suite before implementation
- observed the expected failure because the binding snapshot did not yet expose the full authoritative projection needed by the browser cutover

GREEN:
- implemented `allNodes` / `allEdges`, partial data patching, workspace cutover, and collaboration routing
- reran the focused suite to green
- reran TypeScript, realtime suite, full Spite suite, and production build

## Verification

Commands run successfully at the end:

```bash
cd nexoclip-app/services/spite && rtk npx --yes tsx --test lib/realtime/react-flow-binding.test.ts
cd nexoclip-app/services/spite && rtk tsc --noEmit
cd nexoclip-app/services/spite && rtk npx --yes tsx --test "lib/realtime/**/*.test.ts" "realtime/**/*.test.ts"
cd nexoclip-app/services/spite && rtk npx --yes tsx --test "lib/**/*.test.ts" "realtime/**/*.test.ts"
cd nexoclip-app/services/spite && rtk npm run build
```

Results:
- focused Task 15 suite passed (`6` passed, `0` failed)
- realtime suite passed (`79` passed, `5` skipped, `0` failed)
- full Spite suite passed (`106` passed, `5` skipped, `0` failed)
- TypeScript passed (`0` errors)
- production build completed successfully

Notes:
- `rtk next build` reported `Errors: 0 | Warnings: 0` but exited non-zero via the wrapper, so final build verification used `rtk npm run build` instead.
- skipped realtime DB tests remain gated on `SPITE_TEST_DATABASE_URL` being unset.

## Files changed

Added:
- `nexoclip-app/services/spite/components/canvas/canvas-collaboration.tsx`
- `.superpowers/sdd/2026-09-08-spite-realtime-crdt-canvas/task-15-report.md`

Modified:
- `nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx`
- `nexoclip-app/services/spite/components/canvas/connected-inputs.tsx`
- `nexoclip-app/services/spite/components/canvas/edges/scissors-edge.tsx`
- `nexoclip-app/services/spite/components/canvas/nodes/comment-node.tsx`
- `nexoclip-app/services/spite/components/canvas/nodes/compress-node.tsx`
- `nexoclip-app/services/spite/components/canvas/nodes/image-node.tsx`
- `nexoclip-app/services/spite/components/canvas/nodes/node-toolbar.tsx`
- `nexoclip-app/services/spite/components/canvas/nodes/prompt-node.tsx`
- `nexoclip-app/services/spite/components/canvas/nodes/reference-node.tsx`
- `nexoclip-app/services/spite/components/canvas/nodes/sticker-node.tsx`
- `nexoclip-app/services/spite/components/canvas/nodes/video-node.tsx`
- `nexoclip-app/services/spite/hooks/use-realtime-canvas.ts`
- `nexoclip-app/services/spite/lib/realtime/react-flow-binding.ts`
- `nexoclip-app/services/spite/lib/realtime/react-flow-binding.test.ts`

## Concerns

- The local-mirror audit fixes the main overwrite path, but image/video nodes still have a lot of component-local generation UI state. The durable fields are now routed through Yjs, but those files remain the riskiest area for future collaboration regressions.
- Selection remains local UI state by design. That matches the Task 13/14 invariants, but it means selection itself is not collaborative.
- I intentionally did not fold the deprecated `/api/projects/[projectId]/canvas` endpoint or broader autosave/status cleanup into this task beyond removing browser-side workspace usage; that remains Task 16 territory.
