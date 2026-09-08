# User Credit and Usage Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each signed-in SaaS user their workspace credit balance, generation estimate, and attributable usage history, while allowing owners/admins to inspect workspace-wide usage.

**Architecture:** Add nullable server-owned actor attribution to generation jobs, then expose one tenant-safe `/api/usage` read model that computes balance, monthly summary, and paginated history from existing jobs, provider usage, and credit settlement state. Reuse the existing pricing estimator for preflight estimates and integrate a compact balance pill plus Usage content into `StandaloneShell`; only SaaS generation paths display estimates.

**Tech Stack:** Next.js 15 App Router route handlers, React 19 client components, Node.js `node:test`, raw PostgreSQL via `pg`, SQL migrations, Tailwind CSS.

## Global Constraints

- Credits are the primary user-facing unit; provider units appear only when available.
- Provider monetary cost and `raw_usage` remain server-internal.
- Only SaaS generations using central reservation/settlement are included; no BYOK/direct-provider tracking.
- `created_by_user_id` is always derived from the authenticated session and is never trusted from request JSON.
- Balance stays workspace-level; history defaults to the authenticated user's jobs.
- `scope=workspace` is restricted to workspace owners/admins and includes historical rows with no actor.
- Running jobs display reserved estimated credits; captured jobs display final charged credits; fully released/refunded jobs display zero.
- Existing compatibility routes and generation behavior must remain intact.
- Do not add dependencies or duplicate pricing tables.
- Preserve unrelated changes, including the existing untracked parent plan and `.superpowers/` mockup artifacts.

---

## File map

**Create**

- `src/db/migrations/021_generation_actor.sql` — nullable actor FK and tenant/user/time index.
- `src/repositories/usageRepository.js` — tenant-scoped balance, summary, and history SQL.
- `src/services/usageService.js` — scope authorization, pagination, canonical credit row mapping.
- `app/api/usage/route.js` — authenticated Usage HTTP boundary.
- `app/api/generations/estimate/route.js` — authenticated estimate HTTP boundary.
- `components/UsageContent.js` — Usage cards, scope selector, history, pagination/error states.
- `tests/db/generationActorMigration.test.mjs`
- `tests/usage/usageRepository.test.mjs`
- `tests/usage/usageService.test.mjs`
- `tests/api/usageRoute.test.mjs`
- `tests/api/generationEstimateRoute.test.mjs`
- `tests/frontend/usageContent.test.mjs`

**Modify**

- `src/repositories/generationRepository.js` — insert and return `created_by_user_id`.
- `src/services/generationService.js` — accept server actor ID and pass it to image/ViMax inserts.
- `app/api/generations/route.js` — inject `tenant.user.id` into generation creation.
- `app/api/vimax/jobs/route.js` — inject `tenant.user.id` into ViMax generation creation.
- `components/StandaloneShell.js` — Usage navigation/content, live balance pill, refresh after job lifecycle.
- `packages/studio/src/components/ImageStudio.jsx` — fetch/render SaaS estimate on the image Generate action.
- Existing tests under `tests/generations/` and `tests/api/` — update expected SQL parameters and attribution assertions.

---

### Task 1: Add generation actor attribution migration

**Files:**
- Create: `src/db/migrations/021_generation_actor.sql`
- Create: `tests/db/generationActorMigration.test.mjs`

**Interfaces:**
- Produces: nullable `generation_jobs.created_by_user_id UUID` referencing `users(id)` with `ON DELETE SET NULL`.
- Produces: `generation_jobs_workspace_user_created_idx (workspace_id, created_by_user_id, created_at DESC)`.

- [ ] **Step 1: Write the failing migration contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('generation actor migration adds nullable ownership and lookup index', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/021_generation_actor.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS created_by_user_id UUID/);
  assert.match(sql, /REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(sql, /created_by_user_id UUID NOT NULL/);
  assert.match(sql, /ON generation_jobs \(workspace_id, created_by_user_id, created_at DESC\)/);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `rtk node --test tests/db/generationActorMigration.test.mjs`

Expected: FAIL with `ENOENT` for `021_generation_actor.sql`.

- [ ] **Step 3: Add the migration**

```sql
ALTER TABLE generation_jobs
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID
  REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS generation_jobs_workspace_user_created_idx
  ON generation_jobs (workspace_id, created_by_user_id, created_at DESC);
```

- [ ] **Step 4: Run the migration test and database migration suite**

Run: `rtk node --test tests/db/generationActorMigration.test.mjs tests/db/generationsMigration.test.mjs`

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/db/migrations/021_generation_actor.sql tests/db/generationActorMigration.test.mjs
rtk git commit -m "feat(db): attribute generation actors"
```

---

### Task 2: Create the canonical usage read model

**Files:**
- Create: `src/repositories/usageRepository.js`
- Create: `src/services/usageService.js`
- Create: `tests/usage/usageRepository.test.mjs`
- Create: `tests/usage/usageService.test.mjs`

**Interfaces:**
- Produces: `getUsageBalance(pool, workspaceId) -> Promise<{ balance: string }>`.
- Produces: `getUsageSummary(pool, { workspaceId, userId, scope, periodStart }) -> Promise<{ credits_used: string, generation_count: string }>`.
- Produces: `listUsageHistory(pool, { workspaceId, userId, scope, page, pageSize }) -> Promise<{ rows, total }>`.
- Produces: `createUsageService({ repository, now? }).getUsage({ workspaceId, userId, role, scope, page, pageSize })`.
- Canonical SQL charge expression:
  - `pending` settlement: `estimated_cost`, marked estimated.
  - `captured`: net credit debit from the reservation ledger plus matching capture adjustment entries.
  - `released` or `refunded`: `0`.
  - `provider_usage.actual_cost` is never treated as credits because it may be provider currency.

- [ ] **Step 1: Write failing repository tests for tenant/user filters and safe fields**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getUsageSummary, listUsageHistory } from '../../src/repositories/usageRepository.js';

function pool() {
  const calls = [];
  return { calls, async query(text, values) { calls.push({ text, values }); return { rows: [], rowCount: 0 }; } };
}

test('my usage filters by workspace and authenticated actor', async () => {
  const db = pool();
  await listUsageHistory(db, { workspaceId: 'w1', userId: 'u1', scope: 'me', page: 1, pageSize: 25 });
  assert.match(db.calls[0].text, /gj\.workspace_id = \$1/);
  assert.match(db.calls[0].text, /gj\.created_by_user_id = \$2/);
  assert.deepEqual(db.calls[0].values.slice(0, 2), ['w1', 'u1']);
  assert.doesNotMatch(db.calls[0].text, /raw_usage/);
});

test('workspace usage omits actor filter and uses canonical settlement charge', async () => {
  const db = pool();
  await getUsageSummary(db, { workspaceId: 'w1', userId: 'u1', scope: 'workspace', periodStart: new Date('2026-09-01T00:00:00Z') });
  assert.doesNotMatch(db.calls[0].text, /created_by_user_id =/);
  assert.match(db.calls[0].text, /settlement_status = 'captured'/);
  assert.match(db.calls[0].text, /credit_ledger/);
  assert.match(db.calls[0].text, /reservation_ledger_id/);
  assert.match(db.calls[0].text, /generation_capture/);
  assert.match(db.calls[0].text, /settlement_status IN \('released', 'refunded'\)/);
  assert.doesNotMatch(db.calls[0].text, /pu\.actual_cost/);
});
```

- [ ] **Step 2: Run repository tests and confirm RED**

Run: `rtk node --test tests/usage/usageRepository.test.mjs`

Expected: FAIL because `usageRepository.js` does not exist.

- [ ] **Step 3: Implement repository queries with one shared charge expression**

Use this exported constant in both summary and history SQL so they cannot diverge:

```js
export const CREDIT_CHARGE_SQL = `CASE
  WHEN gj.settlement_status IN ('released', 'refunded') THEN 0::numeric
  WHEN gj.settlement_status = 'captured' THEN GREATEST(
    0::numeric,
    -COALESCE(reservation.amount, -gj.estimated_cost, 0::numeric)
      - COALESCE(adjustments.amount, 0::numeric)
  )
  ELSE COALESCE(gj.estimated_cost, 0::numeric)
END`;
```

Resolve `reservation` from `gj.reservation_ledger_id`. Aggregate `adjustments` from ledger rows with `reason = 'generation_capture'` and `metadata->>'generationId' = gj.id::text`; do not infer credits from `provider_usage.actual_cost`. `listUsageHistory` must select only:

```text
id, created_at, kind, prompt, model, status, provider,
credits, estimated, units
```

Join provider usage through a lateral aggregate so duplicate provider requests do not duplicate generation rows. Count and data queries must use the same workspace/user predicate.

- [ ] **Step 4: Run repository tests and confirm GREEN**

Run: `rtk node --test tests/usage/usageRepository.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write failing service tests for permissions, pagination, and response mapping**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageService } from '../../src/services/usageService.js';

function repository(overrides = {}) {
  return {
    getUsageBalance: async () => ({ balance: '840.000000' }),
    getUsageSummary: async () => ({ credits_used: '160.000000', generation_count: '23' }),
    listUsageHistory: async () => ({ rows: [{ id: 'g1', created_at: new Date('2026-09-07T10:00:00Z'), credits: '8.000000', estimated: false, units: { images: 1 } }], total: 1 }),
    ...overrides,
  };
}

test('member receives only personal paginated usage', async () => {
  const calls = [];
  const service = createUsageService({ repository: repository({
    listUsageHistory: async (args) => { calls.push(args); return { rows: [], total: 0 }; },
  }), now: () => new Date('2026-09-07T12:00:00Z') });
  const data = await service.getUsage({ workspaceId: 'w1', userId: 'u1', role: 'member', scope: 'me', page: '2', pageSize: '500' });
  assert.equal(calls[0].scope, 'me');
  assert.equal(calls[0].userId, 'u1');
  assert.deepEqual(data.pagination, { page: 2, pageSize: 100, total: 0, totalPages: 0 });
  assert.deepEqual(data.permissions, { canViewWorkspace: false });
});

test('member cannot request workspace usage', async () => {
  const service = createUsageService({ repository: repository() });
  await assert.rejects(
    service.getUsage({ workspaceId: 'w1', userId: 'u1', role: 'member', scope: 'workspace' }),
    (error) => error.status === 403 && error.code === 'WORKSPACE_USAGE_FORBIDDEN',
  );
});
```

Also add assertions that invalid scope/page input returns status `400`, owner workspace scope is accepted, period start is UTC month start, decimal strings are preserved, and returned items contain no `actual_cost` or `raw_usage` property.

- [ ] **Step 6: Run service tests and confirm RED**

Run: `rtk node --test tests/usage/usageService.test.mjs`

Expected: FAIL because `usageService.js` does not exist.

- [ ] **Step 7: Implement the service**

```js
export function createUsageService({ repository, now = () => new Date() }) {
  return {
    async getUsage({ workspaceId, userId, role, scope = 'me', page = 1, pageSize = 25 }) {
      // Validate exact scope and positive integer pagination.
      // Authorize workspace scope for owner/admin only.
      // Run balance, summary, and history with Promise.all.
      // Map snake_case repository rows to the API contract.
    },
  };
}
```

Do not import `getPool()` inside the factory. Export a default `usageService` wired to repository functions for the route.

- [ ] **Step 8: Run usage tests and confirm GREEN**

Run: `rtk node --test tests/usage/usageRepository.test.mjs tests/usage/usageService.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
rtk git add src/repositories/usageRepository.js src/services/usageService.js tests/usage
rtk git commit -m "feat(usage): add credit read model"
```

---

### Task 3: Expose tenant-safe `GET /api/usage`

**Files:**
- Create: `app/api/usage/route.js`
- Create: `tests/api/usageRoute.test.mjs`

**Interfaces:**
- Consumes: `usageService.getUsage({ workspaceId, userId, role, scope, page, pageSize })`.
- Produces: `createUsageGetHandler({ resolveContext, service })` for isolated route tests.
- Produces: `GET /api/usage?scope=me|workspace&page=N&pageSize=N`.

- [ ] **Step 1: Write failing route tests**

```js
process.env.DATABASE_URL ||= 'postgres://test:test@localhost/test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageGetHandler } from '../../app/api/usage/route.js';

function request(url, workspaceId = 'w1') {
  const req = new Request(url, { headers: { 'x-workspace-id': workspaceId } });
  req.cookies = { get: () => ({ value: 'session-token' }) };
  return req;
}

test('usage route derives user and role from tenant context', async () => {
  let received;
  const handler = createUsageGetHandler({
    resolveContext: async () => ({ user: { id: 'u1' }, workspace: { id: 'w1', role: 'member' } }),
    service: { getUsage: async (args) => { received = args; return { balance: '8', items: [] }; } },
  });
  const response = await handler(request('http://app/api/usage?scope=me&page=2'));
  assert.equal(response.status, 200);
  assert.equal(received.userId, 'u1');
  assert.equal(received.workspaceId, 'w1');
  assert.equal(received.role, 'member');
  assert.equal(received.page, '2');
});
```

Add cases for missing workspace `400`, missing session `401`, membership denial `403`, and propagated `WORKSPACE_USAGE_FORBIDDEN` `403`.

- [ ] **Step 2: Run and confirm RED**

Run: `rtk node --test tests/api/usageRoute.test.mjs`

Expected: FAIL because the route module does not exist.

- [ ] **Step 3: Implement the route handler factory and production wiring**

Follow the existing `SESSION_COOKIE` plus `resolveTenantContext` pattern. Pass only the resolved tenant IDs/role to the service. Return `{ error, code }` on failures and never echo request payloads or provider data.

- [ ] **Step 4: Run and confirm GREEN**

Run: `rtk node --test tests/api/usageRoute.test.mjs tests/usage/*.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add app/api/usage/route.js tests/api/usageRoute.test.mjs
rtk git commit -m "feat(api): expose user usage"
```

---

### Task 4: Attribute new jobs to the authenticated user

**Files:**
- Modify: `src/repositories/generationRepository.js`
- Modify: `src/services/generationService.js`
- Modify: `app/api/generations/route.js`
- Modify: `app/api/vimax/jobs/route.js`
- Modify: `tests/generations/generationRepository.test.mjs`
- Modify: `tests/generations/generationReservation.test.mjs`
- Modify: `tests/api/vimaxStoryboardJobRoute.test.mjs`
- Create: `tests/api/generationsRoute.test.mjs`

**Interfaces:**
- Changes `createImageGeneration(..., { createdByUserId, ... })`.
- Changes `createVimaxGeneration(..., { createdByUserId, ... })`.
- Changes `createImageGenerationJobWithReservation(pool, workspaceId, input, { userId })`.
- Changes `createVimaxGenerationJobWithReservation(pool, workspaceId, input, { userId })`.

- [ ] **Step 1: Update repository tests first**

Add `createdByUserId: 'u1'` to image and ViMax calls, then assert SQL includes `created_by_user_id`, returned columns include it, and insert values contain `'u1'` in the documented position.

- [ ] **Step 2: Run repository tests and confirm RED**

Run: `rtk node --test tests/generations/generationRepository.test.mjs`

Expected: FAIL because SQL does not contain `created_by_user_id`.

- [ ] **Step 3: Update repository inserts minimally**

Add `created_by_user_id` to `columns`, both reserved/non-reserved image INSERTs, and ViMax INSERT. Do not accept a value from `parameters` or request JSON.

- [ ] **Step 4: Run repository tests and confirm GREEN**

Run: `rtk node --test tests/generations/generationRepository.test.mjs`

Expected: PASS.

- [ ] **Step 5: Update service tests first**

Call reservation services with `{ userId: 'u1' }` as the fourth argument and assert the generation INSERT's values contain `'u1'`. Add a test proving an `input.createdByUserId = 'attacker'` value is ignored.

- [ ] **Step 6: Run reservation tests and confirm RED**

Run: `rtk node --test tests/generations/generationReservation.test.mjs`

Expected: FAIL because actor is not passed to the repository.

- [ ] **Step 7: Thread the server actor through generation services**

Require a non-empty `userId` for reserved SaaS image and ViMax creation and pass it as `createdByUserId`. Keep the unreserved compatibility helper nullable so old internal callers are not broken.

- [ ] **Step 8: Write route attribution tests first**

For image and ViMax route factories, capture service arguments and assert `userId === tenant.user.id` even if the JSON body includes `createdByUserId: 'attacker'`.

- [ ] **Step 9: Run route tests and confirm RED**

Run: `rtk node --test tests/api/generationsRoute.test.mjs tests/api/vimaxStoryboardJobRoute.test.mjs`

Expected: FAIL because routes do not inject the tenant user.

- [ ] **Step 10: Inject actor in both route handlers**

Pass `{ userId: tenant.user.id }` separately from the request input. Preserve existing workspace authorization and idempotency behavior.

- [ ] **Step 11: Run focused generation tests**

Run: `rtk node --test tests/generations/generationRepository.test.mjs tests/generations/generationReservation.test.mjs tests/api/generationsRoute.test.mjs tests/api/vimaxStoryboardJobRoute.test.mjs`

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
rtk git add src/repositories/generationRepository.js src/services/generationService.js app/api/generations/route.js app/api/vimax/jobs/route.js tests/generations tests/api/generationsRoute.test.mjs tests/api/vimaxStoryboardJobRoute.test.mjs
rtk git commit -m "feat(generation): record authenticated actor"
```

---

### Task 5: Add the authoritative estimate endpoint

**Files:**
- Create: `app/api/generations/estimate/route.js`
- Create: `tests/api/generationEstimateRoute.test.mjs`
- Modify: `src/services/generationService.js` only if a thin exported estimator wrapper avoids route duplication.

**Interfaces:**
- Produces: `POST /api/generations/estimate` with `{ operation, quantity, pricingVersion? }`.
- Response: `{ estimate: { pricingVersionId, pricingVersion, operation, unit, quantity, amount } }`.
- Uses `estimateCostForOperation`; no client pricing constants.

- [ ] **Step 1: Write failing endpoint tests**

```js
process.env.DATABASE_URL ||= 'postgres://test:test@localhost/test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationEstimateHandler } from '../../app/api/generations/estimate/route.js';

test('estimate route authorizes workspace and uses server pricing', async () => {
  let args;
  const handler = createGenerationEstimateHandler({
    resolveContext: async () => ({ user: { id: 'u1' }, workspace: { id: 'w1', role: 'member' } }),
    estimate: async (_pool, input) => { args = input; return { amount: '8.000000', operation: input.operation, quantity: input.quantity }; },
    pool: {},
  });
  const req = new Request('http://app/api/generations/estimate', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': 'w1' },
    body: JSON.stringify({ operation: 'image_generation', quantity: 1 }),
  });
  req.cookies = { get: () => ({ value: 'token' }) };
  const response = await handler(req);
  assert.equal(response.status, 200);
  assert.deepEqual(args, { operation: 'image_generation', quantity: 1, pricingVersion: null });
});
```

Add cases rejecting absent workspace, invalid/unknown operation text, non-positive/non-integer quantity, and unauthenticated requests.

- [ ] **Step 2: Run and confirm RED**

Run: `rtk node --test tests/api/generationEstimateRoute.test.mjs`

Expected: FAIL because the endpoint does not exist.

- [ ] **Step 3: Implement the endpoint**

Authorize with `resolveTenantContext`, whitelist an operation string length of 1–120, require integer quantity 1–1000, normalize optional pricing version, then call `estimateCostForOperation`. Do not return rule metadata or provider cost.

- [ ] **Step 4: Run pricing and endpoint tests**

Run: `rtk node --test tests/pricing/pricingService.test.mjs tests/api/generationEstimateRoute.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add app/api/generations/estimate/route.js tests/api/generationEstimateRoute.test.mjs src/services/generationService.js
rtk git commit -m "feat(api): expose generation estimates"
```

---

### Task 6: Build the Usage page content

**Files:**
- Create: `components/UsageContent.js`
- Create: `tests/frontend/usageContent.test.mjs`

**Interfaces:**
- `UsageContent({ workspaceId, initialRole, onBalanceChange })`.
- Fetches `/api/usage?scope=<scope>&page=<page>&pageSize=25` with `x-workspace-id` and same-origin credentials.
- Calls `onBalanceChange(balance)` after a successful response.

- [ ] **Step 1: Write failing pure helper/render contract tests**

To keep Node tests dependency-free, export pure helpers from the component module:

```js
export function formatCredits(value) { /* decimal string -> concise credits */ }
export function formatUnits(units) { /* { tokens: 1200 } -> "1,200 tokens" */ }
export function usagePath({ scope, page }) { /* exact same-origin path */ }
```

Tests:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCredits, formatUnits, usagePath } from '../../components/UsageContent.js';

test('formats credit decimals and optional provider units', () => {
  assert.equal(formatCredits('840.000000'), '840');
  assert.equal(formatCredits('8.500000'), '8.5');
  assert.equal(formatUnits({ tokens: 1200 }), '1,200 tokens');
  assert.equal(formatUnits({}), '—');
});

test('builds a same-origin paginated usage path', () => {
  assert.equal(usagePath({ scope: 'me', page: 2 }), '/api/usage?scope=me&page=2&pageSize=25');
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `rtk node --test tests/frontend/usageContent.test.mjs`

Expected: FAIL because `UsageContent.js` does not exist.

- [ ] **Step 3: Implement helpers and the smallest complete Usage component**

Render:

- loading skeleton/text;
- retryable error state;
- Balance, Used this month, and Generations cards;
- My usage tab;
- Workspace usage tab only when `permissions.canViewWorkspace` is true;
- horizontally scrollable table;
- `est.` suffix when `item.estimated` is true;
- Previous/Next buttons using API pagination;
- empty state when no items exist.

Use `saasFetch` and pass `x-workspace-id`; never read provider credentials.

- [ ] **Step 4: Run helper tests and inspect component for secret/raw fields**

Run: `rtk node --test tests/frontend/usageContent.test.mjs && rtk grep -n 'raw_usage|actual_cost|authorization|x-api-key' components/UsageContent.js`

Expected: tests PASS; grep returns no matches.

- [ ] **Step 5: Commit**

```bash
rtk git add components/UsageContent.js tests/frontend/usageContent.test.mjs
rtk git commit -m "feat(ui): add usage dashboard"
```

---

### Task 7: Integrate balance and Usage into the Studio shell

**Files:**
- Modify: `components/StandaloneShell.js`
- Modify: `tests/frontend/usageContent.test.mjs`

**Interfaces:**
- Consumes `UsageContent`.
- Adds `usage` to recognized Studio tabs without adding it to generation categories.
- Header pill navigates to `/studio/usage`.
- Balance refresh function fetches `scope=me&page=1&pageSize=1` and updates the shared balance.

- [ ] **Step 1: Add failing source-level integration assertions**

Extend the frontend test to read `StandaloneShell.js` and assert:

```js
const source = await readFile(new URL('../../components/StandaloneShell.js', import.meta.url), 'utf8');
assert.match(source, /import UsageContent from ['"]\.\/UsageContent/);
assert.match(source, /id: ['"]usage['"]/);
assert.match(source, /credits/);
assert.doesNotMatch(source, /\$\{balance/);
```

Also assert `<UsageContent` and navigation to `/studio/usage` appear.

- [ ] **Step 2: Run and confirm RED**

Run: `rtk node --test tests/frontend/usageContent.test.mjs`

Expected: FAIL because the shell has no Usage integration and still formats balance with `$`.

- [ ] **Step 3: Integrate Usage and live balance**

Replace `const [balance] = useState(null)` with mutable state plus a memoized `refreshBalance`. Capture the selected workspace from session restore, fetch usage after it is stored, render `UsageContent` for `activeTab === 'usage'`, and make the header pill a button/link that calls `handleTabChange('usage')`.

Update generation completion and error callbacks to call `refreshBalance` after settlement-visible state changes. Avoid polling; refresh at session load and lifecycle boundaries only.

- [ ] **Step 4: Run frontend tests**

Run: `rtk node --test tests/frontend/usageContent.test.mjs tests/frontend/homeRoute.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add components/StandaloneShell.js tests/frontend/usageContent.test.mjs
rtk git commit -m "feat(studio): surface credit usage"
```

---

### Task 8: Show the estimate on the SaaS image Generate action

**Files:**
- Modify: `packages/studio/src/components/ImageStudio.jsx`
- Create: `tests/frontend/imageCreditEstimate.test.mjs`

**Interfaces:**
- Fetches `POST /api/generations/estimate` with operation `image_generation`, quantity `1`, and `x-workspace-id`.
- Displays `Generate · N credits` only when the active path uses SaaS generation and a valid estimate is loaded.
- Keeps `Generate` without a number when estimate is unavailable; generation itself remains server-authoritative.

- [ ] **Step 1: Write a failing source contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('image studio requests and renders a server credit estimate', async () => {
  const source = await readFile(new URL('../../packages/studio/src/components/ImageStudio.jsx', import.meta.url), 'utf8');
  assert.match(source, /\/api\/generations\/estimate/);
  assert.match(source, /image_generation/);
  assert.match(source, /credits/);
  assert.doesNotMatch(source, /CREDITS_PER_USD|unitPrice\s*=/);
});
```

- [ ] **Step 2: Run and confirm RED**

Run: `rtk node --test tests/frontend/imageCreditEstimate.test.mjs`

Expected: FAIL because the component does not request an estimate.

- [ ] **Step 3: Add estimate state and rendering**

On mount/workspace availability, request the estimate with same-origin credentials. Store only the returned amount. Update the primary image Generate button label to append ` · ${formattedAmount} credits`; use plain `Generate` on loading/error and preserve all disabled/loading behavior.

Do not apply this label to direct/BYOK code branches or introduce pricing constants.

- [ ] **Step 4: Run focused frontend and generation tests**

Run: `rtk node --test tests/frontend/imageCreditEstimate.test.mjs tests/api/generationEstimateRoute.test.mjs tests/generations/saasImageGeneration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/studio/src/components/ImageStudio.jsx tests/frontend/imageCreditEstimate.test.mjs
rtk git commit -m "feat(studio): show image credit estimate"
```

---

### Task 9: Full regression and security verification

**Files:**
- Modify only files required to fix failures caused by Tasks 1–8.

**Interfaces:**
- Verifies the complete feature and existing behavior; produces no new API.

- [ ] **Step 1: Run all Node tests**

Run: `rtk node --test tests/**/*.test.mjs`

Expected: all tests PASS. If shell glob expansion is incomplete, run `rtk npm test` only if a test script has been added by another change; otherwise use `rtk find` to enumerate test files and pass them to `node --test`.

- [ ] **Step 2: Run the production build**

Run: `rtk npm run build`

Expected: Next.js production build succeeds with no compile errors.

- [ ] **Step 3: Run migration against an empty development database when available**

Run: `rtk npm run db:migrate`

Expected: migrations `001` through `021` apply successfully. If no disposable database is configured, do not target production; record the missing environment as a verification limitation.

- [ ] **Step 4: Review the complete diff**

Run: `rtk git diff HEAD~8..HEAD && rtk git status --short`

Confirm:

- no provider secret, credential token, `raw_usage`, `.env.local`, or credential header is exposed;
- all usage SQL is scoped by `workspace_id`;
- `scope=me` includes `created_by_user_id`;
- actor comes from `tenant.user.id`;
- no unrelated files or `.superpowers/` artifacts are staged.

- [ ] **Step 5: Run targeted security grep**

Run: `rtk grep -n -i 'api[_-]key|authorization|raw_usage|muapi.*secret' app/api/usage components/UsageContent.js src/services/usageService.js src/repositories/usageRepository.js`

Expected: no secret handling; `raw_usage` may appear only in a negative test assertion, never in the production response/query projection.

- [ ] **Step 6: Final commit only if verification required fixes**

```bash
rtk git add <only-the-files-fixed-during-verification>
rtk git commit -m "fix(usage): resolve integration regressions"
```

- [ ] **Step 7: Update task tracking**

If Notion MCP is connected, update the active task with changed files, exact test/build results, migration verification, blockers, and follow-up. Mark Done only when acceptance criteria and verification pass. If unavailable, report that Notion verification/update was not possible without inventing task state.
