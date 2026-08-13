# Storyboard User-Based Multi-Tenancy MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure each authenticated Nexoclip user gets isolated AI Storyboard sessions, files, artifacts, events, and agent runtime state.

**Architecture:** The Next.js `/api/vimax/[...path]` route authenticates the existing session, derives `session.user_id`, overwrites the trusted tenant header, and forwards requests to the internal Storyboard service. The Storyboard service validates the tenant header in production and resolves all state beneath `.tenants/<tenantId>/`; the existing per-tenant agent map and limits remain the runtime boundary.

**Tech Stack:** Next.js App Router route handlers, Node.js HTTP server, Python agent subprocess, Vitest, Node filesystem APIs, Docker Compose.

## Global Constraints

- Canonical MVP identity is the authenticated user's stable `user.id` / existing session `user_id`.
- The browser must not choose a tenant; the server proxy overwrites `x-nexoclip-tenant`.
- Production requests without a valid tenant header return `401`.
- Development may retain the `default` fallback for standalone local engine usage.
- Tenant data is rooted at `.tenants/<tenantId>/`.
- Provider configuration remains global for the MVP.
- Do not modify unrelated files already deleted or changed in the working tree.
- Preserve existing SSE, binary artifact, upload, and JSON proxy behavior.

---

## Task 1: Lock down tenant identity and filesystem boundary

**Files:**
- Create: `ai-engine-storyboard/web/tenant.mjs`
- Create: `ai-engine-storyboard/web/tenant.test.mjs`
- Modify: `ai-engine-storyboard/web/server.mjs:20-75`

**Interfaces:**
- Produces `tenantIdFromRequest(request, {production}) -> string` or throws an error with `statusCode=401`.
- Produces `tenantRoot(repoRoot, tenantId) -> string`.
- Produces `isValidTenantId(value) -> boolean`.
- `server.mjs` consumes these helpers instead of embedding tenant parsing/path logic.

- [ ] **Step 1: Write failing unit tests**

Add Vitest cases:

```js
it('accepts a safe tenant header', () => {
  const request = {headers: {'x-nexoclip-tenant': 'user_123'}};
  expect(tenantIdFromRequest(request, {production: true})).toBe('user_123');
});

it('rejects missing tenant in production', () => {
  expect(() => tenantIdFromRequest({headers: {}}, {production: true}))
    .toThrow(expect.objectContaining({statusCode: 401}));
});

it('keeps default fallback only outside production', () => {
  expect(tenantIdFromRequest({headers: {}}, {production: false})).toBe('default');
});

it('rejects traversal and malformed values before path resolution', () => {
  expect(() => tenantIdFromRequest({headers: {'x-nexoclip-tenant': '../other'}}, {production: true}))
    .toThrow(expect.objectContaining({statusCode: 401}));
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd ai-engine-storyboard/web && npm test -- tenant.test.mjs
```

Expected: FAIL because `tenant.mjs` does not exist.

- [ ] **Step 3: Implement the minimal tenant module**

Use the exact validation rule `/^[A-Za-z0-9._-]{1,128}$/`. Read the header case-insensitively through `request.headers[TENANT_HEADER]`; return `default` only when `production` is false. For production missing/invalid values, throw an `Error` with `statusCode = 401`. Build the tenant root with `path.join(repoRoot, '.tenants', tenantId)` only after validation.

- [ ] **Step 4: Refactor the server to consume the module**

Import the helper, define `const isProduction = process.env.NODE_ENV === 'production'`, and replace the inline `tenantIdOf` and `tenantRootOf`. Ensure the request handler derives the tenant before `getTenant`, so invalid production requests cannot create an in-memory tenant entry or filesystem directory.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd ai-engine-storyboard/web && npm test -- tenant.test.mjs server-lib.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add ai-engine-storyboard/web/tenant.mjs ai-engine-storyboard/web/tenant.test.mjs ai-engine-storyboard/web/server.mjs
rtk git commit -m "feat: enforce storyboard tenant boundaries"
```

---

## Task 2: Verify and harden the authenticated Nexoclip proxy

**Files:**
- Modify: `nexoclip-app/app/api/vimax/[...path]/route.js`
- Create: `nexoclip-app/app/api/vimax/[...path]/route.test.js` (or the repository's established route-test location if Next route imports cannot run directly)

**Interfaces:**
- The route continues exporting `GET`, `POST`, `PUT`, `DELETE`, and `PATCH` handlers.
- The proxy sets `x-nexoclip-tenant` to the authenticated session's `user_id` and never forwards a browser-provided tenant value.

- [ ] **Step 1: Inspect the existing auth test conventions**

Use the existing auth service/session route tests to match the repository's mocking style. Do not introduce a new test framework or auth abstraction.

- [ ] **Step 2: Add failing proxy behavior tests**

Cover these behaviors:

```js
it('returns 401 and does not fetch without a session', async () => {
  // mock getCurrentSession -> null; assert response.status === 401 and fetch not called
});

it('overwrites a client tenant with authenticated user_id', async () => {
  // mock session {user_id: 'user_123'} and upstream response;
  // send x-nexoclip-tenant: attacker; assert upstream request header is user_123
});
```

Also assert the target is formed only from `VIMAX_SERVICE_URL` plus the route path/query, and that request body/content type remain forwarded.

- [ ] **Step 3: Run the focused tests and verify failure or missing coverage**

Run the repository-specific route test command, for example:

```bash
cd nexoclip-app && npm test -- app/api/vimax/[...path]/route.test.js
```

If no test script exists, run the configured Vitest/Jest command directly and record the exact command in the commit/PR notes.

- [ ] **Step 4: Harden the route implementation**

Keep the current session lookup and trusted-header overwrite. Explicitly omit any incoming `x-nexoclip-tenant`, `host`, and forwarding headers from the upstream request. Validate `session.user_id` is a non-empty safe string before forwarding; return `401` if not. Keep streaming response handling and the existing allowlisted response headers.

- [ ] **Step 5: Run the focused proxy tests**

Expected: PASS, including SSE/body forwarding tests if present.

- [ ] **Step 6: Commit**

```bash
rtk git add nexoclip-app/app/api/vimax/[...path]/route.js nexoclip-app/app/api/vimax/[...path]/route.test.js
rtk git commit -m "feat: trust authenticated storyboard tenants"
```

---

## Task 3: Add cross-tenant isolation regression coverage

**Files:**
- Modify: `ai-engine-storyboard/web/server.test.mjs` (create if absent)
- Modify: `ai-engine-storyboard/web/server-lib.test.mjs` only if a helper-level case belongs there
- Modify: `ai-engine-storyboard/web/server.mjs` only for testability seams needed by the tests

**Interfaces:**
- Tests exercise the HTTP server boundary, not only pure helper functions.
- No production API contract changes beyond the tenant authentication behavior defined in the spec.

- [ ] **Step 1: Add failing HTTP-level cases**

Cover:

```js
it('returns 401 for requests without a tenant in production', async () => {
  // start server with NODE_ENV=production and request /api/sessions without header
});

it('allows the same session ID in two tenant roots without collision', async () => {
  // issue requests with user_a and user_b, create/read their state, and assert roots/data are separate
});

it('does not deliver tenant A events to tenant B subscribers', async () => {
  // open both event streams, trigger tenant A activity, assert only A receives the event
});
```

Use temporary repositories/working directories and close the server in `afterEach`; avoid relying on the developer's real `.tenants` directory.

- [ ] **Step 2: Run the tests to verify the missing behavior**

Run:

```bash
cd ai-engine-storyboard/web && npm test -- server.test.mjs
```

Expected: the new cases fail or expose missing injection seams.

- [ ] **Step 3: Add only the minimal test seams**

If needed, extract server creation into `createServer({repoRoot, env, ...})` while preserving the CLI startup behavior. Do not rewrite the request handlers or introduce a framework.

- [ ] **Step 4: Implement/fix the minimum required behavior**

Ensure tenant derivation occurs before tenant map creation and every route uses the derived tenant root. Confirm event subscribers are stored on the tenant object, never globally.

- [ ] **Step 5: Run the full Storyboard web test suite**

```bash
cd ai-engine-storyboard/web && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add ai-engine-storyboard/web/server.test.mjs ai-engine-storyboard/web/server.mjs ai-engine-storyboard/web/server-lib.test.mjs
rtk git commit -m "test: cover storyboard tenant isolation"
```

---

## Task 4: Document and verify deployment configuration

**Files:**
- Modify: `ai-engine-storyboard/web/README.md`
- Modify: `ai-engine-storyboard/readme.md` only if the same setup is documented there
- Modify: `docker-compose.yml` only if required by test/deployment verification
- Modify: `nexoclip-app/.env.example` to document `VIMAX_SERVICE_URL` without secrets

- [ ] **Step 1: Document local and production contracts**

Document:

```text
Local standalone engine: missing tenant -> default only when NODE_ENV=development.
Production internal service: x-nexoclip-tenant is required and must come from the authenticated Nexoclip proxy.
Docker: Nexoclip uses http://ai-storyboard:4173; do not publish port 4173 publicly.
```

Document `.tenants/<userId>/` ownership and the fact that provider configuration is global for MVP.

- [ ] **Step 2: Add configuration guards**

Ensure production startup does not silently use the development fallback. Keep `VIMAX_SERVICE_URL` server-only and do not add any `NEXT_PUBLIC_` tenant/service variable.

- [ ] **Step 3: Run verification**

```bash
cd ai-engine-storyboard/web && npm test
cd ../../nexoclip-app && npm run build
```

Expected: Storyboard tests pass and Next.js build completes without route/runtime errors.

- [ ] **Step 4: Inspect the final diff without touching unrelated work**

```bash
rtk git diff -- ai-engine-storyboard/web nexoclip-app/app/api/vimax docker-compose.yml
rtk git status --short
```

Confirm only planned files changed.

- [ ] **Step 5: Commit**

```bash
rtk git add ai-engine-storyboard/web/README.md ai-engine-storyboard/readme.md nexoclip-app/.env.example docker-compose.yml
rtk git commit -m "docs: document storyboard tenant deployment"
```

---

## Final verification checklist

- [ ] Two authenticated users can use identical session IDs independently.
- [ ] User A cannot read, mutate, delete, upload to, or receive events from user B.
- [ ] Browser-supplied tenant headers are ignored/overwritten.
- [ ] Production requests without tenant identity return `401`.
- [ ] Development standalone fallback still works.
- [ ] Provider config is not stored under tenant directories.
- [ ] `npm test` passes in `ai-engine-storyboard/web`.
- [ ] `npm run build` passes in `nexoclip-app`.
- [ ] Existing unrelated deleted/modified files remain untouched.
