# Task 7 Report

## Status
Implemented Task 7 only: pure crypto/token policy helpers for the main app and Spite realtime service.

## Scope kept intentionally narrow
- Added transport-independent HMAC helpers for canvas authorization signing and verification.
- Added transport-independent `jose` HS256 realtime JWT issue/verify helpers with fixed issuer, audience, and 60-second TTL.
- Did **not** add routes, session lookups, ownership queries, Canvas Auth orchestration, or nonce persistence.

## Files
- `nexoclip-app/src/lib/realtime/internalAuth.js`
- `nexoclip-app/src/lib/realtime/token.js`
- `nexoclip-app/tests/realtime/internalAuth.test.mjs`
- `nexoclip-app/services/spite/realtime/internal-auth.ts`
- `nexoclip-app/services/spite/realtime/auth.ts`
- `nexoclip-app/services/spite/realtime/auth.test.ts`

## TDD evidence
### RED
Focused tests were written before implementation and initially failed because the new modules did not exist yet.

Commands:
- `cd nexoclip-app && rtk test "node --test tests/realtime/internalAuth.test.mjs"`
- `cd nexoclip-app/services/spite && rtk npx tsx --test realtime/auth.test.ts`

Observed failures:
- App: `ERR_MODULE_NOT_FOUND` for `src/lib/realtime/internalAuth.js`
- Spite: `MODULE_NOT_FOUND` for `./internal-auth`

### GREEN
After implementing the helpers, both focused suites passed.

## Verification evidence
- `cd nexoclip-app && rtk proxy node --test tests/realtime/internalAuth.test.mjs`
  - Result: 5 tests passed, 0 failed
- `cd nexoclip-app/services/spite && rtk npx tsx --test realtime/auth.test.ts`
  - Result: 5 tests passed, 0 failed
- `cd nexoclip-app/services/spite && rtk npx tsc --noEmit`
  - Result: `TypeScript: No errors found`
- `cd /Users/lovinsmwn/Documents/production/nexoclip/.worktrees/feat-spite-realtime-crdt && rtk git diff --check`
  - Result: clean

## Behavior implemented
### Canvas authorization HMAC
- Canonical payload serialization is field-order independent at the call site.
- Verification rejects altered payloads.
- Signature comparison uses a manual constant-time byte walk over the longer input.
- Verification rejects stale and future timestamps outside the 60-second window.

### Realtime JWT policy
- `HS256` only
- issuer: `nexoclip`
- audience: `nexoclip-realtime`
- lifetime: `60` seconds
- project-bound verification via `expectedProjectId`
- rejection coverage for wrong algorithm, signature, issuer, audience, expiry, and project

## Concerns
- Running the focused app test directly with raw Node emits an existing package-level warning because `nexoclip-app/package.json` does not declare `"type": "module"` while these helper files use ESM syntax. The tests still pass, and this task intentionally does not widen scope to repo-wide module-format changes.
