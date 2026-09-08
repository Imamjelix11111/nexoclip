# Task 6 Report

## Status
Task 6 review round 2 implemented the remaining open findings without reverting the earlier valid shutdown projection-timer fix.

## Files
- `nexoclip-app/services/spite/realtime/project-runtime.ts`
- `nexoclip-app/services/spite/realtime/project-runtime.test.ts`
- `.superpowers/task-6-report.md`

## Prior completed fix preserved
- Kept the existing shutdown behavior that cancels pending projection debounce/retry timers during `ProjectRuntime.shutdown()`.

## Round 2 fixes
- Added env-backed compaction thresholds: `SPITE_REALTIME_COMPACT_AFTER_UPDATES` (default `128`) and `SPITE_REALTIME_COMPACT_AFTER_BYTES` (default `262144`).
- Added durable post-append counters for update count and byte size since the last successful compaction.
- Triggered compaction after successful durable appends when either threshold is reached.
- Reset threshold counters only after successful compaction.
- Split compaction scheduling so idle debounce still resets per durable commit, while the periodic safety timer starts once, fires independently of ongoing commits, and re-arms after each tick instead of being cleared/recreated on every append.

## TDD evidence
### RED
Focused runtime test before implementation:
- `cd nexoclip-app/services/spite && rtk npx tsx --test realtime/project-runtime.test.ts`
- Result: 3 failing tests
  - `compaction runs after the durable update-count threshold is reached`
  - `compaction runs after the durable byte threshold is reached`
  - `periodic compaction keeps firing under sustained writes`

### GREEN
Focused runtime test after implementation:
- `cd nexoclip-app/services/spite && rtk npx tsx --test realtime/project-runtime.test.ts`
- Result: 11 passed, 0 failed

## Verification evidence
- `cd nexoclip-app/services/spite && rtk tsc --noEmit`
  - Result: `TypeScript: No errors found`
- `cd nexoclip-app/services/spite && rtk npm run test:realtime`
  - Result: 52 tests, 47 passed, 0 failed, 5 skipped
  - Skipped integration tests required `SPITE_TEST_DATABASE_URL`
- `rtk git diff --check`
  - Result: clean

## Notes
- The recurring interval timer now continues to protect active rooms during sustained writes even when every commit lands before the idle debounce can fire.
- Threshold-triggered compaction still uses the existing serialized storage path, so durable appends, compaction, and shutdown remain ordered per project.
