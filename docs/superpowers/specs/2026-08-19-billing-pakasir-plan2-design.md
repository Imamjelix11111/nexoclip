# Billing (Pakasir) — Plan 2: Monthly Packages, COGS Tracking, Billing UI

**Status:** Design approved, ready for implementation plan. Depends on Plan 1
(`2026-08-19-billing-pakasir-plan1-design.md`).

## Problem

Plan 1 delivers credit top-up (pay via Pakasir → credits granted). Plan 2 adds:

1. **Monthly credit packages** ("subscription" packages) — since Pakasir is
   one-time-only, these are manually re-purchased each period, not auto-charged.
2. **COGS tracking** — record each generation's real OpenRouter USD cost for
   margin analysis, without changing what users are charged (credits).
3. **Billing UI** — balance widget, transaction history, packages/pricing page,
   subscription status.

## What Plan 1 already provides (reused)

- Pakasir adapter (`buildPaymentUrl`, `verifyTransaction`, `parseWebhook`).
- `payment_orders` table + repository (with a `kind` column already allowing
  `subscription`).
- The webhook handler that verifies a payment and grants credits idempotently.
- `credit_accounts` / `credit_ledger` / `creditService`.
- Existing `billing_plans` and `workspace_subscriptions` tables (from earlier
  migrations) — Plan 2 finally uses them.

## Components

### 1. Monthly package purchase

- `billing_plans` already holds the packages (`code`, `name`, `monthly_credits`,
  `metadata`). Plan 2 adds an `amount_idr` to each plan's metadata (or a column)
  so a plan maps to a Pakasir price.
- `POST /api/billing/subscribe` (auth + workspace): body `{ planCode }`. Creates
  a `payment_orders` row with `kind = 'subscription'`, `credits = monthly_credits`,
  `amount_idr` from the plan, `metadata = { planCode }`; returns the Pakasir
  `payment_url` (same builder as top-up).

### 2. Webhook handler extension (activate package)

Extend the Plan 1 webhook handler: after verifying a `completed` payment, branch
on the order's `kind`:

- `topup` → grant credits (Plan 1 behavior, unchanged).
- `subscription` → in one transaction:
  1. Grant `credits` (`monthly_credits`) via the ledger
     (`reason: 'subscription', idempotencyKey: orderId`).
  2. Upsert `workspace_subscriptions`: set `billing_plan_id`, `status = 'active'`,
     `current_period_start = now()`, `current_period_end = now() + 30 days`,
     `provider_key = 'pakasir'`, `provider_subscription_id = orderId`.
  Idempotent by `orderId` on both the ledger and the order's `paid` transition.

No auto-renewal (Pakasir can't). At `current_period_end` the subscription simply
lapses; the user re-purchases to renew. A lapsed subscription's status moves to
`past_due`/`canceled` lazily on read (or via a lightweight daily check —
implementation detail for the plan). Credits already granted do **not** expire
in Plan 2 (credit expiry is an explicit non-goal).

### 3. COGS tracking

- The OpenRouter image/video adapters already return `usage.cost` (USD). When a
  generation settles (the existing `generationCreditSettlementService` path),
  record the real USD cost into the settlement ledger entry's `metadata`
  (`{ cogs_usd, provider: 'openrouter', model }`).
- This changes only what is *recorded*, not what the user is charged (still
  credits per `pricing_rules`). Enables a later margin report:
  credits_charged × credit_value − Σ cogs_usd.
- A read-only internal helper `src/services/marginReport.js` can aggregate
  cogs_usd vs credits over a period (thin; no UI required in this plan).

### 4. Billing UI

In the app (studio shell / account area):

- **Credit balance widget** — current `credit_accounts.balance`, always visible.
- **Packages / pricing page** — top-up packages (Plan 1 catalog) + monthly plans
  (`billing_plans`), each with a buy button that hits `/api/billing/topup` or
  `/api/billing/subscribe` and redirects to Pakasir.
- **Subscription status** — current plan, period end, "renew" button; shows
  "lapsed — renew" when past `current_period_end`.
- **Transaction history** — read `credit_ledger` (grants + spends) and
  `payment_orders` (purchases) for the workspace, paginated.
- New read routes: `GET /api/billing/balance`, `GET /api/billing/history`,
  `GET /api/billing/subscription`.

## Data flow (subscription purchase)

1. User picks a monthly plan → `POST /api/billing/subscribe` → `payment_url`.
2. Pays on Pakasir → webhook verified → grant `monthly_credits` + activate
   `workspace_subscriptions` for 30 days.
3. UI shows active plan + period end. At expiry, status lapses; user re-buys.

## Error handling

- Same verification guarantees as Plan 1 (authoritative detail-API check;
  idempotent grants). A subscription webhook cannot double-grant or
  double-activate.
- Buying a plan while one is active → allowed; extends/replaces the period from
  `now()` (simple, predictable). The plan documents this rule explicitly.
- COGS recording failure must never fail the generation settlement — it is
  best-effort metadata; wrap it so a cost-record error is logged, not fatal.

## Testing

- `subscribe` route + webhook: a `subscription` order, once paid, grants the
  monthly credits and sets `workspace_subscriptions` period; duplicate webhook
  does not double-grant or double-extend.
- Lapse logic: a subscription past `current_period_end` reads as lapsed.
- COGS: a settled generation records `cogs_usd` in the ledger metadata; a
  cost-record failure does not roll back the settlement.
- Billing read routes: balance, history, and subscription are workspace-scoped
  (no cross-workspace leakage).

## Non-goals (Plan 2)

- Auto-recurring billing (Pakasir cannot; out of scope permanently for this
  provider).
- Credit expiry, refunds, proration, invoices/receipts.
- Dunning / email reminders for lapsed subscriptions (a reminder job can be a
  later, separate task).
- A margin/analytics dashboard UI (the `marginReport` helper exposes the data;
  visualizing it is future work).
