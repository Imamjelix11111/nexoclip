# Auth Session Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side opaque session token utilities and session lookup/revocation endpoints on top of the dedicated NexoClip PostgreSQL database.

**Architecture:** Generate random opaque tokens on the server, store only SHA-256 hashes in PostgreSQL, and put the raw token only in an HttpOnly cookie. Repository functions own SQL; the auth service owns token lifecycle; route handlers expose current-session lookup and logout. Existing MuAPI/BYOK routes remain unchanged.

**Tech Stack:** Next.js App Router route handlers, Node `crypto`, raw PostgreSQL via `pg`, built-in `node:test`.

## Global Constraints

- Use the dedicated `nexoclip` PostgreSQL database, never `ai_service`.
- Never store or log raw session tokens.
- Use HttpOnly, SameSite=Lax cookies; Secure in production.
- Do not use `muapi_key` as SaaS identity or authorization.
- Do not modify existing MuAPI compatibility routes.

---

### Task 1: Token and cookie primitives

**Files:**
- Create: `src/lib/auth/session.js`
- Test: `tests/auth/session.test.mjs`

**Interfaces:**
- Produces `createSessionToken()`, `hashSessionToken(token)`, `sessionCookieOptions()`.

- [ ] Write failing tests for token length/uniqueness, deterministic hashing, and cookie flags.
- [ ] Run `node --test tests/auth/session.test.mjs`; expect module-not-found failure.
- [ ] Implement the minimal crypto and cookie option helpers.
- [ ] Re-run the focused test and expect PASS.

### Task 2: Session repository

**Files:**
- Create: `src/repositories/sessionRepository.js`
- Test: `tests/auth/sessionRepository.test.mjs`

**Interfaces:**
- Produces `createSessionRecord(client, { userId, tokenHash, expiresAt })`, `findActiveSession(client, tokenHash)`, and `revokeSession(client, tokenHash)`.

- [ ] Write tests using a small fake client that records parameterized SQL calls and returns representative rows.
- [ ] Run the focused test and verify it fails because the repository does not exist.
- [ ] Implement parameterized SQL only; active lookup must reject revoked and expired sessions.
- [ ] Re-run focused tests and expect PASS.

### Task 3: Auth service and route handlers

**Files:**
- Create: `src/services/authService.js`
- Create: `app/api/auth/session/route.js`
- Create: `app/api/auth/logout/route.js`
- Test: `tests/auth/authService.test.mjs`

**Interfaces:**
- `createSession({ userId, ttlSeconds })` returns `{ token, expiresAt }` and persists only the hash.
- `getCurrentSession(token)` returns the active session or `null`.
- `revokeCurrentSession(token)` revokes the session.

- [ ] Write service tests with injected fake repository/pool boundaries.
- [ ] Run focused tests and verify failure.
- [ ] Implement the service with a transaction for session creation and safe cleanup.
- [ ] Implement GET `/api/auth/session` returning `{ authenticated: false }` when absent and a minimal user/session payload when valid.
- [ ] Implement POST `/api/auth/logout` to revoke and clear the cookie.
- [ ] Run focused tests and syntax checks.

### Task 4: Configuration and verification

**Files:**
- Modify: `package.json` only if a focused test script is needed.
- Modify: `docs/superpowers/specs/2026-04-10-auth-database-foundation-design.md` only if implementation details materially change.

- [ ] Run `node --test tests/auth/*.test.mjs`.
- [ ] Run `node --check` on all new JavaScript files.
- [ ] Run `DATABASE_URL='postgres://nexoclip:nexoclip_dev@127.0.0.1:5434/nexoclip' npm run db:migrate`.
- [ ] Run `git diff --check` and inspect status for secrets or unrelated changes.
