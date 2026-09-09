# Task 10 Report

## Status
Implemented Hocuspocus lifecycle coverage for Awareness sanitization, durable status/ACK ordering, read-only admission, server-time lock expiry, and graceful shutdown in `nexoclip-app/services/spite/realtime/server.ts`.

## Files
- Modified: `nexoclip-app/services/spite/realtime/server.ts`
- Created: `nexoclip-app/services/spite/realtime/server-lifecycle.test.ts`

## Verification
- `cd nexoclip-app/services/spite && rtk proxy npx tsx --test realtime/server-core.test.ts realtime/server-lifecycle.test.ts realtime/project-runtime.test.ts`
- `cd nexoclip-app/services/spite && rtk err npx tsc --noEmit`

## Guarantees covered
- Pre-hydration auth invariant preserved by keeping ownership/token checks before hydration and re-running `server-core.test.ts`.
- Durable client ACK only after enqueue resolves; tests prove `Yjs update -> enqueue -> Neon COMMIT -> PERSISTED -> ACK` and no premature ACK while append is pending/failed.
- Awareness sanitizes forged `userId`/`name`, allocates room-scoped `Guest N`, reuses released names, and expires locks from server-observed heartbeat time.
- Read-only rooms still admit presence while rejecting new document mutations before application.
- Graceful shutdown marks rooms read-only, flushes pending updates, compacts, then destroys the server/pool without premature ACK.

## Concerns
- Stateless payload contracts are now JSON messages (`STATUS`, `ACK`) but the client-side hook that consumes them is still future Task 14/16 work.
- The existing Node test environment still prints Hocuspocus/localStorage experimental warnings; tests pass despite that noise.

## Commit
- `feat(spite): manage realtime room lifecycle`

## Retry Round 1: Awareness collision hardening

### Status
Hardened Task 10 awareness ownership so server-side participant bookkeeping is keyed by authenticated `socketId + awareness clientId`, while client `participantId` stays a continuity hint only.

### Files
- Modified: `nexoclip-app/services/spite/realtime/server.ts`
- Modified: `nexoclip-app/services/spite/realtime/server-lifecycle.test.ts`

### Verification
- `cd nexoclip-app/services/spite && rtk proxy npx tsx --test realtime/server-core.test.ts realtime/server-lifecycle.test.ts realtime/project-runtime.test.ts`
- `cd nexoclip-app/services/spite && rtk tsc --noEmit`

### Guarantees covered
- Two sockets forging the same client `participantId` now receive distinct `Guest N` labels because allocation is keyed by authenticated connection identity plus awareness client ID.
- Refcounts, disconnect cleanup, and lock timers no longer collide across forged `participantId` reuse, so one socket cannot clear or extend another socket's lock.
- Awareness metadata updates triggered by server-side lock expiry now use the injected lifecycle clock instead of wall-clock `Date.now()`.
- Task 11 ownership files/routes remain untouched; the diff stays inside Task 10 realtime lifecycle files.

### Concerns
- The focused collision test relies on the provider-level async awareness propagation path, so it still carries the existing localStorage experimental warning noise from the test environment.

### Commit
- `fix(spite): harden awareness participant keys`
