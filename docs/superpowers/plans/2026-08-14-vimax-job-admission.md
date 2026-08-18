# ViMax Durable Job Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant-safe, transactional, idempotent admission path for durable ViMax planning/render jobs so the FastAPI/BullMQ runtime can be reached without abusing image-generation contracts.

**Architecture:** Extend the existing `generation_jobs` table and its current credit reservation transaction; do not create another job table. ViMax jobs use explicit kinds and structured parameters. Initial seeded prices are zero credits for all ViMax operations. Zero-cost jobs have no credit-ledger reservation because the ledger intentionally rejects zero-amount financial movements; a later pricing-rule update enables the normal reservation path without changing the admission API.

**Tech Stack:** raw PostgreSQL migrations, Node.js ESM, `pg`, existing repository/service layers, `node:test`.

## Global Constraints

- Preserve unrelated dirty auth, credits, Compose, UI, and previous-task changes.
- PostgreSQL remains the source of truth; use the existing `generation_jobs`, `credit_accounts`, `credit_ledger`, pricing, and limits tables.
- The client never chooses a workspace authorization boundary; route-level workspace resolution remains server-side.
- All ViMax admission must be transactional and idempotent with `workspace_id` plus idempotency key.
- ViMax operation prices are seeded at `0.000000` credits initially; prices are configurable exclusively through existing pricing rules.
- A zero-cost admission creates the job transactionally with `reservation_ledger_id = NULL`; a nonzero price creates the normal `generation_reservation` ledger entry in that same transaction.
- Job parameters contain only structured command data; no filesystem root, runtime token, provider credential, or client-owned workspace path.
- Follow TDD: every new behavior must fail before implementation.

---

### Task 1: Add ViMax kinds, seeded pricing, and a transactional job-admission service

**Files:**
- Create: `nexoclip-app/src/db/migrations/018_vimax_generation_admission.sql`
- Modify: `nexoclip-app/src/repositories/generationRepository.js`
- Modify: `nexoclip-app/src/services/generationService.js`
- Test: `nexoclip-app/tests/db/vimaxGenerationAdmissionMigration.test.mjs`
- Test: `nexoclip-app/tests/generations/generationRepository.test.mjs`
- Test: `nexoclip-app/tests/generations/generationReservation.test.mjs`
- Test: `nexoclip-app/tests/generations/generationService.test.mjs`

**Interfaces:**
- Consumes: `findPricingRule`, existing credit account lock/ledger helpers, existing limits enforcement, and `findGenerationByIdempotencyKey`.
- Produces:
  - `validateVimaxGenerationInput(input) -> { kind, prompt, model, parameters, operation }`
  - `createVimaxGenerationJobWithReservation(pool, workspaceId, input) -> generation_jobs row`
  - `createVimaxGeneration(client, input) -> generation_jobs row`

- [ ] **Step 1: Write the migration test first**

```js
test('allows explicit ViMax generation kinds and seeds configurable zero-credit operations', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const kind of ['vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video']) {
    assert.match(sql, new RegExp(kind));
  }
  for (const operation of ['vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video']) {
    assert.match(sql, new RegExp(`'${operation}'.*0\\.000000`));
  }
});
```

- [ ] **Step 2: Run it red**

Run: `cd nexoclip-app && node --test tests/db/vimaxGenerationAdmissionMigration.test.mjs`

Expected: FAIL because migration 018 does not exist.

- [ ] **Step 3: Write the additive migration**

```sql
ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_kind_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_kind_check
  CHECK (kind IN ('image', 'vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video'));

INSERT INTO pricing_rules (pricing_version_id, operation, unit, unit_price, metadata)
SELECT id, seed.operation, 'job', 0.000000::numeric,
       '{"provider":"vimax","development":true,"configurable":true}'::jsonb
FROM pricing_versions
CROSS JOIN (VALUES
  ('vimax_narrative_planning'),
  ('vimax_novel_planning'),
  ('vimax_render_video')
) AS seed(operation)
WHERE version = 1
ON CONFLICT (pricing_version_id, operation) DO NOTHING;
```

- [ ] **Step 4: Run migration test green**

Run: `cd nexoclip-app && node --test tests/db/vimaxGenerationAdmissionMigration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write failing input-validation tests**

```js
test('validates a structured ViMax render request without image-only fields', () => {
  assert.deepEqual(validateVimaxGenerationInput({
    kind: 'vimax_render_video', sessionId: 'session-1', input: { render_mode: 'foreground' }, idempotencyKey: 'r1',
  }), {
    kind: 'vimax_render_video', prompt: 'Render ViMax storyboard video', model: 'vimax',
    operation: 'vimax_render_video',
    parameters: { sessionId: 'session-1', input: { render_mode: 'foreground' } },
  });
});

test('rejects unknown ViMax kinds and invalid session identifiers', () => {
  assert.throws(() => validateVimaxGenerationInput({ kind: 'image', sessionId: 's1' }), /ViMax generation kind is invalid/);
  assert.throws(() => validateVimaxGenerationInput({ kind: 'vimax_render_video', sessionId: '../etc' }), /ViMax session id is invalid/);
});
```

- [ ] **Step 6: Run validation tests red**

Run: `cd nexoclip-app && node --test tests/generations/generationService.test.mjs`

Expected: FAIL because `validateVimaxGenerationInput` is not exported.

- [ ] **Step 7: Implement narrow validation**

Allow only:

```js
const VIMAX_KINDS = new Set([
  'vimax_narrative_planning',
  'vimax_novel_planning',
  'vimax_render_video',
]);
const VIMAX_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/;
```

For every valid kind, require a valid `sessionId`; allow only plain-object `input`; clone it as JSON data; set canonical `prompt` and `model` constants shown in the test; set operation equal to kind. Do not accept `workspaceId`, `tenantRoot`, credentials, or arbitrary top-level parameters.

- [ ] **Step 8: Run validation tests green**

Run: `cd nexoclip-app && node --test tests/generations/generationService.test.mjs`

Expected: PASS.

- [ ] **Step 9: Write failing repository/reservation tests**

```js
test('creates a reserved ViMax job with explicit kind and structured parameters', async () => {
  const job = await createVimaxGenerationJobWithReservation(pool, 'w1', {
    kind: 'vimax_render_video', sessionId: 's1', input: {}, idempotencyKey: 'request-1',
  });
  const insert = pool.calls.find((call) => /INSERT INTO generation_jobs/.test(call.text));
  assert.match(insert.text, /kind/);
  assert.equal(insert.values[2], 'vimax_render_video');
  assert.equal(pool.calls.filter((call) => /INSERT INTO credit_ledger/.test(call.text)).length, 0);
  assert.equal(job.reservation_ledger_id, null);
  assert.equal(job.status, 'queued');
});

test('returns the prior ViMax job for the same workspace idempotency key without a second ledger insert', async () => {
  const pool = poolFor({ existing: { id: 'existing', status: 'queued' } });
  const job = await createVimaxGenerationJobWithReservation(pool, 'w1', validVimaxInput());
  assert.equal(job.id, 'existing');
  assert.equal(pool.calls.filter((call) => /INSERT INTO credit_ledger/.test(call.text)).length, 0);
});
```

- [ ] **Step 10: Run reservation tests red**

Run: `cd nexoclip-app && node --test tests/generations/generationRepository.test.mjs tests/generations/generationReservation.test.mjs`

Expected: FAIL because the ViMax repository/service functions do not exist.

- [ ] **Step 11: Implement generic-but-narrow repository and service composition**

Add `createVimaxGeneration` with explicit insert columns:

```sql
(workspace_id, project_id, kind, prompt, model, parameters, idempotency_key,
 estimated_cost, pricing_version_id, reservation_ledger_id, vimax_session_id, provider)
```

with `provider = 'vimax'` and session id sourced only from validated parameters.

Implement `createVimaxGenerationJobWithReservation` by duplicating the proven image transaction only where its input/repository differ:

```text
BEGIN → existing job lookup → find pricing by validated operation → estimate quantity 1
→ enforce limits → for nonzero cost only: create+lock credit account, debit, append generation_reservation ledger
→ insert ViMax job (with null reservation ledger for zero cost) → COMMIT
```

Keep error behavior and rollback semantics identical to `createImageGenerationJobWithReservation`. On a `23505` unique conflict, roll back then read the existing job by `(workspace_id, idempotency_key)` and return it; rethrow every other database error. Do not refactor existing image flow in this task.

- [ ] **Step 12: Run full admission suite green**

Run:
```bash
cd nexoclip-app && node --test tests/db/vimaxGenerationAdmissionMigration.test.mjs tests/generations/generationRepository.test.mjs tests/generations/generationReservation.test.mjs tests/generations/generationService.test.mjs
```

Expected: PASS.

- [ ] **Step 13: Review and commit**

Run:
```bash
rtk git diff --check
rtk git diff -- nexoclip-app/src/db/migrations/018_vimax_generation_admission.sql nexoclip-app/src/repositories/generationRepository.js nexoclip-app/src/services/generationService.js nexoclip-app/tests/db/vimaxGenerationAdmissionMigration.test.mjs nexoclip-app/tests/generations/generationRepository.test.mjs nexoclip-app/tests/generations/generationReservation.test.mjs nexoclip-app/tests/generations/generationService.test.mjs
```

Commit:
```bash
rtk git add nexoclip-app/src/db/migrations/018_vimax_generation_admission.sql nexoclip-app/src/repositories/generationRepository.js nexoclip-app/src/services/generationService.js nexoclip-app/tests/db/vimaxGenerationAdmissionMigration.test.mjs nexoclip-app/tests/generations/generationRepository.test.mjs nexoclip-app/tests/generations/generationReservation.test.mjs nexoclip-app/tests/generations/generationService.test.mjs
rtk git commit -m "feat: admit durable ViMax generation jobs"
```
