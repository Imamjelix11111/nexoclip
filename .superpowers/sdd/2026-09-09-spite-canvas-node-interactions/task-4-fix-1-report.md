# Task 4 Fix 1 Report — Follow Scene Validation

## Scope

Implemented only the Task 4 review findings; Task 5 was not started.

## Changes

- `resolveFollowTarget` now restricts selected-node fallback to nodes whose `data.sceneId` matches a nonempty peer `sceneId`. This prevents centering on a stale selection from another scene.
- Added a focused regression test with a cross-scene stale selection followed by a matching selection. The test failed before the fix by returning the stale node position and passes after it.
- Guest-list Follow is disabled unless the peer has a nonempty scene ID that resolves to a known scene. The displayed text remains `No scene` for unknown scene IDs. Workspace handler validation remains unchanged as defense in depth.

## Verification

Passed:

```bash
cd nexoclip-app/services/spite && ./node_modules/.bin/tsx --test lib/canvas-node-interactions.test.ts lib/realtime/presence.test.ts
```

Result: 28 tests passed, 0 failed.

Attempted:

```bash
cd nexoclip-app && rtk npm run build
```

Result: could not run because the root installation has no `node_modules/.bin/next` (`sh: next: command not found`).

## Concerns

- The root Next.js build could not run in this worktree because root dependencies are not installed. The focused service test runner is installed and passed.
- No component-level test infrastructure exists for `CanvasGuestList`; its disabled state is a direct predicate over the known `scenes` list.
