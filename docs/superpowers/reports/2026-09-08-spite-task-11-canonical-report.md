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
