# Task 8 Report

## Status
Implemented Task 8 only: the main app HTTP orchestration route for realtime canvas token issuance.

## Scope kept intentionally narrow
- Added a dependency-injected Next route factory at `POST /api/auth/realtime-token`.
- Reused Task 7 crypto/token helpers for Canvas Auth request signing and realtime JWT issuance.
- Validated session presence and `projectId` UUID shape.
- Ignored browser-supplied `userId`; only the authenticated session user is trusted.
- Mapped Canvas Auth denial and upstream failures to public-safe responses without leaking internal URLs, secrets, or upstream messages.
- Did **not** implement the private Canvas Auth endpoint, nonce persistence logic, or broader realtime service behavior.

## Files
- `nexoclip-app/app/api/auth/realtime-token/route.js`
- `nexoclip-app/tests/realtime/realtimeTokenRoute.test.mjs`

## TDD evidence
### RED
Wrote the focused route tests before the route existed, then ran:
- `cd nexoclip-app && rtk test "node --test tests/realtime/realtimeTokenRoute.test.mjs"`

Observed failure:
- `ERR_MODULE_NOT_FOUND` for `app/api/auth/realtime-token/route.js`

### GREEN
Implemented the route factory and re-ran the focused suite.

## Verification evidence
- `cd nexoclip-app && rtk test "node --test tests/realtime/realtimeTokenRoute.test.mjs"`
  - Result: passing
- `cd nexoclip-app && rtk proxy node --test tests/realtime/internalAuth.test.mjs tests/realtime/realtimeTokenRoute.test.mjs`
  - Result: 12 tests passed, 0 failed
- `cd /Users/lovinsmwn/Documents/production/nexoclip/.worktrees/feat-spite-realtime-crdt && rtk git diff --check`
  - Result: clean

## Behavior implemented
- Returns `401` for missing/invalid session.
- Returns `400` for malformed `projectId` values.
- Returns `503` when `CANVAS_AUTH_URL`, `CANVAS_AUTH_SECRET`, or `REALTIME_TOKEN_SECRET` is missing.
- Signs a trusted Canvas Auth payload `{ userId, projectId, timestamp, nonce }` with Task 7 HMAC helpers.
- Posts only server-derived authorization data to `CANVAS_AUTH_URL`.
- Returns `403` when Canvas Auth denies access.
- Returns `502` on upstream Canvas Auth failures without exposing internals.
- Issues `{ token, expiresAt }` only after an explicit `{ authorized: true }` response.

## Concerns
- Focused raw Node test runs still emit the existing repo-level `[MODULE_TYPELESS_PACKAGE_JSON]` warning because `nexoclip-app/package.json` does not declare `"type": "module"` while these files use ESM syntax. This task intentionally does not widen scope to module-format changes.
