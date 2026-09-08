# Task 11 Canonical Report — Spite same-origin HTTP identity and ownership

Date: 2026-09-08
Plan source: `docs/superpowers/plans/2026-09-08-spite-realtime-crdt-canvas.md`
Recon source: `docs/superpowers/plans/2026-09-08-spite-realtime-reconnaissance.md`
History reviewed: `f90c1ab`, `dcc0905`

## Scope executed

Implemented Task 11: add same-origin Spite HTTP identity and enforce project ownership across Spite HTTP routes that read or mutate project-scoped data.

## What changed

### 1. Main-app session introspection for Spite

Added:
- `nexoclip-app/services/spite/lib/main-session.ts`
- `nexoclip-app/services/spite/lib/main-session.test.ts`

Behavior:
- forwards only `nexoclip_session` to `NEXOCLIP_INTERNAL_URL/api/auth/session`
- ignores client-supplied identity headers
- fails closed on missing config, missing cookie, invalid payload, non-OK response, or fetch error
- returns trusted `{ id }` only from successful introspection

### 2. Shared ownership helpers

Added:
- `nexoclip-app/services/spite/lib/project-ownership.ts`
- `nexoclip-app/services/spite/lib/project-ownership.test.ts`

Behavior:
- standardized `401 Unauthorized` for missing authenticated user
- standardized `404 Project not found` / `404 Folder not found` / `404 Asset not found` for ownership failures without leaking existence
- helper predicates for owned project, owned folder, and owned generation asset lookup

### 3. Middleware gate updated

Modified:
- `nexoclip-app/services/spite/middleware.ts`

Behavior:
- preserves required-env boot gate
- strips spoofable `x-nexoclip-user-*` headers before forwarding
- denies `/api/internal/*` publicly with `404`
- treats either a valid legacy `spite_session` or a valid same-origin `nexoclip_session` as authenticated

### 4. Project ownership enforcement

Modified project and project-adjacent routes:
- `app/api/projects/route.ts`
- `app/api/projects/[projectId]/route.ts`
- `app/api/projects/[projectId]/duplicate/route.ts`
- `app/api/projects/[projectId]/canvas/route.ts`
- `app/api/projects/[projectId]/canvas/snapshots/route.ts`
- `app/api/projects/[projectId]/assets/route.ts`
- `app/api/projects/[projectId]/assets/upload/route.ts`

Behavior:
- removed placeholder `DEFAULT_USER_ID` usage from project create/duplicate
- project creation now uses trusted authenticated user id
- project listing now filters by `projects.userid`
- project get/update/delete, duplicate, canvas, snapshots, and project asset routes require ownership before access

### 5. Asset / folder / generation route enforcement

Modified:
- `app/api/assets/route.ts`
- `app/api/folders/route.ts`
- `app/api/folders/[folderId]/route.ts`
- `app/api/generate/submit/route.ts`
- `app/api/generate/status/route.ts`
- `app/api/generate/latest/route.ts`
- `app/api/generate/recover/route.ts`

Behavior:
- asset library without `projectId` now returns assets only from owned projects
- project-scoped asset and folder endpoints require ownership
- generation submit/status/latest/recover check ownership before provider work or project-scoped reads/writes when a project is involved
- recover bulk mode without explicit `projectId` is now limited to projects owned by the authenticated user

## TDD notes

This was reimplemented test-first rather than replaying `f90c1ab` directly.

RED observed:
- `lib/main-session.test.ts` failed because `main-session.ts` did not exist
- `lib/project-ownership.test.ts` failed because route handler factories and ownership logic did not exist

GREEN achieved after implementation.

## Verification run

Because `pnpm` is not available in this harness, verification used the installed toolchain via `npx`.

Commands run successfully:

```bash
cd nexoclip-app/services/spite && npx --yes tsx --test "lib/**/*.test.ts"
cd nexoclip-app/services/spite && npx --yes tsc --noEmit
```

Result:
- 39 tests passed
- 0 failed
- TypeScript emitted no errors

## Relation to reviewed history

- `f90c1ab` was used as historical context for route coverage and ownership intent.
- `dcc0905` confirmed that the earlier attempt had been reverted, so the implementation here was rebuilt from the Task 11 brief and current repository state instead of resurrecting the reverted patch blindly.

## Follow-on relevance

This unblocks later realtime tasks by ensuring:
- Spite HTTP routes can resolve trusted main-app identity
- project creation and duplication use real owners
- project existence is not leaked cross-user
- pre-realtime HTTP mutation paths are at least ownership-safe before Task 17 moves them behind the realtime runtime

---

# Task 13 Round 1 Follow-up — scoped quality fixes

Date: 2026-09-08
Plan source: `docs/superpowers/plans/2026-09-08-spite-realtime-crdt-canvas.md`
Commit under review: `3396c1e`

## Scope executed

Addressed only the real Task 13 quality findings in the provider hook and its focused realtime tests.

Explicitly not done here:
- no `canvas-workspace` wiring
- no removal of legacy REST hydration from `canvas-workspace`
- no Task 15 behavior changes

## What changed

### 1. Removed duplicate awareness subscription paths

Modified:
- `nexoclip-app/services/spite/hooks/use-realtime-canvas.ts`

Behavior:
- keeps a single awareness subscription path via direct `awareness.on/off`
- removes duplicate provider-level `onAwarenessChange` / `onAwarenessUpdate` callbacks
- each awareness event now emits exactly one room snapshot notification instead of double-emitting

### 2. Strengthened reconnect-token coverage through the provider seam

Modified:
- `nexoclip-app/services/spite/lib/realtime/react-flow-binding.test.ts`

Behavior:
- fake provider now exercises the configured provider `token` callback directly
- test simulates two provider token requests representing connect + reconnect
- verification now proves the configured callback issues two POSTs to `/api/auth/realtime-token`
- coverage no longer relies on calling `room.getToken()` directly, which bypassed the provider seam under review

### 3. Added focused regression for awareness emission count

Modified:
- `nexoclip-app/services/spite/lib/realtime/react-flow-binding.test.ts`

Behavior:
- explicit regression test emits `change` and `update` separately
- asserts one room emission per awareness event
- confirms peer projection stays correct while preventing duplicate notifications

## TDD notes

RED observed first with focused realtime coverage:
- awareness regression failed with `2 !== 1`, proving duplicate emissions per awareness event
- token-callback coverage was rewritten to exercise the provider seam rather than the room method directly

GREEN achieved with one production change: removing the duplicate provider callback path from `use-realtime-canvas.ts`.

## Verification run

Commands run successfully:

```bash
cd nexoclip-app/services/spite && npx tsx --test lib/realtime/react-flow-binding.test.ts
cd nexoclip-app/services/spite && npm run test:realtime
cd nexoclip-app/services/spite && tsc -p tsconfig.json --noEmit
```

Result:
- focused binding/realtime test: 5 passed, 0 failed
- full realtime suite: 70 passed, 0 failed, 5 skipped (`SPITE_TEST_DATABASE_URL` unset)
- TypeScript: no errors

## Follow-on relevance

This keeps Task 13 tight while improving correctness for Task 14/15 follow-up work:
- awareness consumers will not receive duplicate room emissions from a single underlying event
- reconnect auth coverage now verifies the real configured provider callback path
- later `canvas-workspace` integration can proceed without reintroducing these hook-level regressions
