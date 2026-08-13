# AI Storyboard Usage Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meter actual OpenRouter usage from AI Storyboard and settle the existing workspace credit ledger, with 100 onboarding credits and safe per-provider-call reservations.

**Architecture:** Nexoclip's Node/Postgres application remains the single owner of credits, usage records, reservations, and settlement. ViMax reports lifecycle usage to authenticated internal endpoints rather than writing the database. LLM usage comes from LangChain responses; image/video usage comes from OpenRouter adapters. Provider USD costs convert to UI credits at 100 credits per USD, rounded up to one decimal credit.

**Tech Stack:** Next.js App Router, Node.js, PostgreSQL, Python 3, LangChain, OpenRouter, Vitest, Python unittest.

## Global Constraints

- One credit equals USD 0.01; `credits = ceil(costUsd * 1000) / 10`.
- Apply no pricing margin in MVP.
- Meter a provider call only when it runs; ordinary local/status messages cost zero.
- Keep `OPENROUTER_API_KEY` server-only.
- ViMax must not connect directly to Nexoclip's database.
- Video, embedding, and reranker remain fixed OpenRouter models; only Agent LLM and Image models are user-selectable.
- All balance mutations must use the existing append-only ledger and idempotency keys.
- Do not call real provider or payment APIs from tests.

---

### Task 1: Credit pricing and onboarding grant primitives

**Files:**
- Create: `nexoclip-app/src/services/creditPricingService.js`
- Modify: `nexoclip-app/src/services/creditService.js`
- Modify: `nexoclip-app/src/services/workspaceService.js` or the workspace creation call site discovered during implementation
- Create: `nexoclip-app/tests/credits/creditPricingService.test.mjs`
- Modify: `nexoclip-app/tests/credits/creditService.test.mjs`

**Interfaces:**
- Produces `costUsdToCredits(costUsd): number`, returning non-negative credits rounded upward to 0.1.
- Produces `grantOnboardingCredits(pool, {workspaceId}): Promise<CreditEntry>`, an idempotent +100 credit grant with key `onboarding:<workspaceId>`.

- [ ] **Step 1: Write failing pricing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {costUsdToCredits} from '../../src/services/creditPricingService.js';

test('converts provider USD to credits rounded up to one decimal', () => {
  assert.equal(costUsdToCredits(0), 0);
  assert.equal(costUsdToCredits(0.00018), 0.1);
  assert.equal(costUsdToCredits(0.024), 2.4);
  assert.equal(costUsdToCredits(1), 100);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
cd nexoclip-app && rtk npm test -- tests/credits/creditPricingService.test.mjs
```

Expected: failure because `creditPricingService.js` does not exist.

- [ ] **Step 3: Implement conversion and onboarding helper**

```js
export function costUsdToCredits(costUsd) {
  const cost = Number(costUsd);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('Provider cost is invalid');
  return Math.ceil(cost * 1000 - Number.EPSILON) / 10;
}

export async function grantOnboardingCredits(pool, {workspaceId}) {
  return appendCreditEntry(pool, {
    workspaceId,
    amount: 100,
    reason: 'onboarding_grant',
    idempotencyKey: `onboarding:${workspaceId}`,
    metadata: {credits: 100},
  });
}
```

Invoke `grantOnboardingCredits` only after a workspace is successfully created, using the same `workspaceId`; do not grant again when creation is retried.

- [ ] **Step 4: Run focused credit tests**

```bash
cd nexoclip-app && rtk npm test -- tests/credits/creditPricingService.test.mjs tests/credits/creditService.test.mjs
```

Expected: passing tests.

- [ ] **Step 5: Commit**

```bash
rtk git add nexoclip-app/src/services nexoclip-app/tests/credits
rtk git commit -m "feat(credits): grant onboarding balance"
```

### Task 2: Internal credit reservation API

**Files:**
- Create: `nexoclip-app/src/services/storyboardCreditService.js`
- Create: `nexoclip-app/app/api/internal/storyboard-credits/[action]/route.js`
- Modify: `nexoclip-app/src/lib/auth/` or create a focused internal-service authentication helper following existing server-only patterns
- Create: `nexoclip-app/tests/credits/storyboardCreditService.test.mjs`
- Create: `nexoclip-app/tests/api/storyboardCreditsInternal.test.mjs`

**Interfaces:**
- `reserveStoryboardCredits(pool, {workspaceId, idempotencyKey, estimatedCostUsd, metadata})` reserves `costUsdToCredits(estimatedCostUsd)` via existing credit ledger functionality and returns `{reservationId, reservedCredits, balance}`.
- `captureStoryboardCredits(pool, {workspaceId, reservationId, idempotencyKey, actualCostUsd, usage})` captures actual credits and refunds unused reservation idempotently.
- `releaseStoryboardCredits(pool, {workspaceId, reservationId, idempotencyKey, reason})` fully refunds an unused reservation idempotently.
- Internal routes accept only a service credential and validated workspace identity. They never return API keys or raw sensitive provider payloads.

- [ ] **Step 1: Write failing service tests**

Cover reserve/capture/refund using a fake transactional pool:

```js
test('reserves estimated provider cost before a call', async () => {
  const result = await reserveStoryboardCredits(pool, {
    workspaceId: 'w1', idempotencyKey: 'llm:req-1', estimatedCostUsd: 0.024,
  });
  assert.equal(result.reservedCredits, 2.4);
});

test('captures actual cost and refunds unused credits once', async () => {
  const result = await captureStoryboardCredits(pool, {
    workspaceId: 'w1', reservationId: 'r1', idempotencyKey: 'llm:req-1:capture', actualCostUsd: 0.018,
  });
  assert.equal(result.actualCredits, 1.8);
  assert.equal(result.refundedCredits, 0.6);
});
```

- [ ] **Step 2: Run focused test and confirm RED**

```bash
cd nexoclip-app && rtk npm test -- tests/credits/storyboardCreditService.test.mjs
```

Expected: fail because service is missing.

- [ ] **Step 3: Implement service using existing reservation/settlement conventions**

Use database transactions, row locks, append-only ledger entries, and deterministic idempotency keys. Store `action`, `sessionId`, `sceneIndex`, `model`, `providerRequestId`, and sanitized usage metadata in ledger metadata. A capture with missing actual cost must retain the reservation and return a reconciliation-needed status; it must not silently refund.

- [ ] **Step 4: Write and implement authenticated route tests**

Test rejected missing/invalid service credential, rejected unknown action, tenant/workspace mismatch, insufficient balance without provider invocation, and successful reserve/capture/release response contracts.

- [ ] **Step 5: Run focused tests**

```bash
cd nexoclip-app && rtk npm test -- tests/credits/storyboardCreditService.test.mjs tests/api/storyboardCreditsInternal.test.mjs
```

Expected: passing tests.

- [ ] **Step 6: Commit**

```bash
rtk git add nexoclip-app/src/services/storyboardCreditService.js nexoclip-app/app/api/internal nexoclip-app/tests/credits/storyboardCreditService.test.mjs nexoclip-app/tests/api/storyboardCreditsInternal.test.mjs
rtk git commit -m "feat(credits): add storyboard settlement API"
```

### Task 3: ViMax OpenRouter usage instrumentation

**Files:**
- Create: `nexoclip-app/services/vimax/agent_runtime/credit_meter.py`
- Modify: `nexoclip-app/services/vimax/agent_runtime/vimax_adapters.py`
- Modify: `nexoclip-app/services/vimax/tools/image_generator_openrouter_api.py`
- Modify: `nexoclip-app/services/vimax/tools/video_generator_openrouter_api.py`
- Modify: `nexoclip-app/services/vimax/web/server.mjs`
- Create: `nexoclip-app/services/vimax/tests/test_credit_meter.py`
- Modify: `nexoclip-app/services/vimax/tests/test_vimax_adapters.py`
- Modify: `nexoclip-app/services/vimax/tests/test_openrouter_video_generator.py`

**Interfaces:**
- `CreditMeter.reserve(...)`, `capture(...)`, and `release(...)` call the internal Node API using `VIMAX_CREDITS_INTERNAL_URL` and `VIMAX_CREDITS_SERVICE_TOKEN` injected only by the service environment.
- `meter_llm_call` reserves before `ainvoke`, extracts LangChain `usage_metadata`/response metadata safely, captures actual OpenRouter cost when available, and releases on provider failure.
- Image/video adapters expose sanitized usage/cost and provider request ID to the meter.

- [ ] **Step 1: Write failing meter tests**

```python
async def test_reserves_then_captures_actual_openrouter_cost():
    client = FakeInternalCreditClient()
    meter = CreditMeter(client)
    reservation = await meter.reserve(action="llm", estimated_cost_usd=0.03, idempotency_key="k1")
    settled = await meter.capture(reservation, actual_cost_usd=0.018, usage={"input_tokens": 12, "output_tokens": 4})
    assert settled["actual_credits"] == 1.8

async def test_releases_reservation_when_provider_call_fails():
    ...
```

- [ ] **Step 2: Run focused Python test and confirm RED**

```bash
cd nexoclip-app/services/vimax && rtk .venv/bin/python -m unittest tests.test_credit_meter
```

Expected: failure because module is missing.

- [ ] **Step 3: Implement internal client and safe usage extraction**

- Use an explicit request timeout.
- Never include `OPENROUTER_API_KEY` in request, response, exception, logs, or metadata.
- Derive estimated cost from an environment-owned bounded price table per operation/model; use conservative caps for video.
- Treat `usage.cost`, `response_metadata`, and `usage_metadata` as optional. If no actual cost is present after a successful provider call, report reconciliation-required instead of refunding.

- [ ] **Step 4: Integrate meter around each billable provider boundary**

Wrap Agent LLM calls, image generation, and video creation/poll completion. Tag each operation with session and scene information available in adapter runtime context. Do not meter embedding/reranker yet beyond emitting zero-cost usage metadata.

- [ ] **Step 5: Run focused Python tests**

```bash
cd nexoclip-app/services/vimax && rtk .venv/bin/python -m unittest tests.test_credit_meter tests.test_vimax_adapters tests.test_openrouter_video_generator
```

Expected: all pass without network calls.

- [ ] **Step 6: Commit**

```bash
rtk git add nexoclip-app/services/vimax/agent_runtime nexoclip-app/services/vimax/tools nexoclip-app/services/vimax/web/server.mjs nexoclip-app/services/vimax/tests
rtk git commit -m "feat(storyboard): meter OpenRouter usage"
```

### Task 4: Wire internal authentication and credit balance UI

**Files:**
- Modify: `docker-compose.yml`
- Modify: `nexoclip-app/.env.example`
- Modify: `nexoclip-app/components/vimax/reused/ViMaxApp.tsx`
- Modify: `nexoclip-app/components/vimax/reused/api.ts`
- Modify: `nexoclip-app/components/vimax/reused/types.ts`
- Modify: `nexoclip-app/components/vimax/reused/styles.css`
- Create: `nexoclip-app/tests/credits/storyboardBalance.test.mjs`

**Interfaces:**
- The web app exposes a tenant-authenticated read-only balance endpoint sourced from the credit account/ledger.
- ViMax receives only internal URL and service token through Docker/service environment; browser receives neither.
- UI shows `N credits` and shows reserve/settlement status for expensive work; it never displays raw USD/token/provider payloads.

- [ ] **Step 1: Write failing read-only balance API and UI helper tests**

```js
test('returns a workspace credit balance only to its authenticated tenant', async () => {
  const response = await getWorkspaceCredits(authenticatedRequest('workspace-a'));
  assert.deepEqual(await response.json(), {balance: '100.0'});
});
```

- [ ] **Step 2: Run test and confirm RED**

```bash
cd nexoclip-app && rtk npm test -- tests/credits/storyboardBalance.test.mjs
```

Expected: failure because balance endpoint/UI API function is absent.

- [ ] **Step 3: Implement balance endpoint and compact UI display**

Show balance in the AI Storyboard composer/header. Refresh after agent events and show a non-blocking insufficient-credit error returned by the internal metering flow. Preserve the existing Agent/Image model selector and do not reintroduce settings/provider/API-key UI.

- [ ] **Step 4: Inject only server-side internal credentials**

Add documented empty environment keys:

```env
VIMAX_CREDITS_INTERNAL_URL=http://nexoclip-app:3000/api/internal/storyboard-credits
VIMAX_CREDITS_SERVICE_TOKEN=
```

Use Docker Compose secret/environment interpolation for both services. Do not prefix either with `NEXT_PUBLIC_`.

- [ ] **Step 5: Run focused test/build**

```bash
cd nexoclip-app && rtk npm test -- tests/credits/storyboardBalance.test.mjs
cd nexoclip-app/services/vimax/web && rtk npm run build
```

Expected: passing tests and build.

- [ ] **Step 6: Commit**

```bash
rtk git add docker-compose.yml nexoclip-app/.env.example nexoclip-app/app nexoclip-app/components/vimax nexoclip-app/tests/credits
rtk git commit -m "feat(storyboard): show credit balance"
```

### Task 5: Admin and CLI credit grants

**Files:**
- Modify: `nexoclip-app/app/api/admin/audit/route.js` or add a scoped admin credits route following existing authorization patterns
- Create: `nexoclip-app/scripts/grant-credits.mjs`
- Create: `nexoclip-app/tests/credits/grantCredits.test.mjs`
- Modify: `nexoclip-app/README.md`

**Interfaces:**
- `node scripts/grant-credits.mjs --workspace <uuid> --credits <positive-number> --reason <text> --key <idempotency-key>` appends an admin grant and prints resulting balance.
- Admin endpoint and CLI use `appendCreditEntry`; both require positive finite grants, reason, and idempotency key.

- [ ] **Step 1: Write failing grant validation/idempotency tests**

```js
test('admin grant appends an idempotent positive ledger entry', async () => {
  const result = await grantCredits({workspaceId: 'w1', credits: 25, reason: 'manual_grant', idempotencyKey: 'grant-1'});
  assert.equal(result.balanceAfter, 125);
});

test('rejects zero, negative, missing reason, and missing idempotency key', async () => {
  ...
});
```

- [ ] **Step 2: Run focused test and confirm RED**

```bash
cd nexoclip-app && rtk npm test -- tests/credits/grantCredits.test.mjs
```

Expected: failure because grant command/service is absent.

- [ ] **Step 3: Implement service reuse, protected admin route, and CLI**

Use `appendCreditEntry` with `reason: 'admin_grant'`; include source/actor metadata. The CLI must take its database configuration from server environment and never accept/provider API keys.

- [ ] **Step 4: Document local use**

Add exact invocation and explain that payment/top-up is intentionally not implemented:

```bash
node scripts/grant-credits.mjs --workspace <uuid> --credits 25 --reason goodwill --key goodwill-2026-08-13-user
```

- [ ] **Step 5: Run focused tests**

```bash
cd nexoclip-app && rtk npm test -- tests/credits/grantCredits.test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
rtk git add nexoclip-app/app/api/admin nexoclip-app/scripts/grant-credits.mjs nexoclip-app/tests/credits/grantCredits.test.mjs nexoclip-app/README.md
rtk git commit -m "feat(credits): add admin grants"
```

### Task 6: Full verification and security review

**Files:**
- Verify only.

- [ ] **Step 1: Run Node test suite**

```bash
cd nexoclip-app && rtk npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run ViMax Python tests**

```bash
cd nexoclip-app/services/vimax && rtk .venv/bin/python -m unittest discover -s tests
```

Expected: all tests pass.

- [ ] **Step 3: Build and configuration verification**

```bash
cd nexoclip-app/services/vimax/web && rtk npm run build
cd ../../.. && rtk docker compose config --quiet
rtk git diff --check
```

Expected: commands exit 0.

- [ ] **Step 4: Security grep**

```bash
cd nexoclip-app && rtk proxy rg -n 'OPENROUTER_API_KEY|VIMAX_CREDITS_SERVICE_TOKEN' app components services/vimax/web --glob '*.{js,jsx,ts,tsx,mjs}'
```

Expected: no browser/client response exposes either credential; server-only source references are limited to configuration/injected internal client code.

- [ ] **Step 5: Commit final verification changes**

```bash
rtk git add -A
rtk git commit -m "test(credits): verify storyboard metering"
```
