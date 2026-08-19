# Billing (Pakasir) — Plan 1: Payment Plumbing + Credit Top-Up

**Status:** Design approved, ready for implementation plan.

## Problem

NexoClip needs a working money-in flow: a user buys credits with real money
and their workspace credit balance increases. The billing provider is
**Pakasir** (Indonesian aggregator, one-time payments only — QRIS + virtual
accounts; no recurring subscriptions). Plan 1 delivers the core top-up flow.
Plan 2 (separate) adds monthly packages, COGS tracking, and the full billing
UI.

## Model decisions (locked)

- **Credit system**, not USD-to-user. Users buy and spend credits. The
  existing foundation is credit-based and is reused, not rebuilt.
- Real per-generation USD cost (OpenRouter `usage.cost`) is tracked internally
  for margin analysis — that wiring is Plan 2; Plan 1 only handles money-in.

## What already exists (reused, not rebuilt)

- `credit_accounts` (balance per workspace), `credit_ledger` (immutable,
  idempotent by `(workspace_id, idempotency_key)`).
- `creditService.appendCreditEntry(pool, entry)` /
  `appendCreditEntryInTransaction(client, {workspaceId, amount, reason, idempotencyKey, metadata})`.
- `billingService.createBillingWebhookService({ pool, verifier, handler })` —
  generic webhook processor with injectable verifier + handler.
- `billing_webhook_events` (webhook idempotency by `(provider_key, event_id)`).
- `app/api/billing/webhooks/route.js` — existing webhook entry point.
- `PAKASIR_API_KEY`, `PAKASIR_BASE_URL` (`https://app.pakasir.com`),
  `PAKASIR_PROJECT_SLUG` (`nexoclip`) already in env.

## Pakasir integration facts (from provider docs)

- **Hosted payment page:** `https://app.pakasir.com/pay/{slug}/{amount}?order_id={order_id}&redirect={returnUrl}`
  (append `qris_only=1` to force QRIS). This is the simplest integration —
  redirect the user there; no server-side create call required.
- **Webhook payload** (POST to our configured webhook URL on completion):
  `{ amount, order_id, project, status, payment_method, completed_at }`.
  There is **no signature**. Verification is mandatory via the detail API.
- **Transaction detail (verify):** `GET https://app.pakasir.com/api/transactiondetail?project={slug}&amount={amount}&order_id={order_id}&api_key={key}`
  — the authoritative check that the payment truly completed for that amount.

## Components

### 1. Pakasir provider adapter (`src/providers/pakasir/`)

- `buildPaymentUrl({ amount, orderId, redirectUrl, qrisOnly })` → the hosted
  page URL. Pure string builder, unit-testable.
- `verifyTransaction({ amount, orderId })` → GET the detail API with the server
  `PAKASIR_API_KEY`, return `{ paid: boolean, raw }`. Never trust the webhook
  body alone.
- `parseWebhook(body)` → normalize `{ orderId, amount, status, project }`.
  Rejects a payload whose `project` ≠ our slug.

These become the `verifier` (verifyTransaction) and are consumed by the
existing `billingService` webhook processor. The webhook event id is the Pakasir
`order_id` (unique per payment) so `billing_webhook_events` dedupes replays.

### 2. Payment order tracking (new table)

Pakasir's webhook carries only `order_id` + `amount`, so we must record what
each order was for. New migration adds `payment_orders`:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `order_id` | TEXT UNIQUE NOT NULL | our generated id, sent to Pakasir |
| `workspace_id` | UUID FK → `workspaces(id)` | who is buying |
| `kind` | TEXT | `topup` (Plan 1). `subscription` added in Plan 2 |
| `amount_idr` | INTEGER NOT NULL | rupiah charged |
| `credits` | NUMERIC(20,6) NOT NULL | credits to grant on success |
| `status` | TEXT | `pending`/`paid`/`failed`/`expired` |
| `metadata` | JSONB | e.g. the top-up package code |
| `created_at` / `paid_at` | TIMESTAMPTZ | |

Index on `(workspace_id, created_at DESC)`.

Repository `src/repositories/paymentOrderRepository.js` owns the SQL.

### 3. Top-up packages

A small static catalog of top-up options (`src/services/topupPackages.js`) —
e.g. `{ code, credits, amount_idr }` rows like `500 credits → Rp 25.000`. The
credit↔IDR ratio and package set are config, not hardcoded in routes. (Exact
prices are a product decision; the plan seeds a couple of starter packages that
are easy to edit.)

### 4. Top-up initiation route

`POST /api/billing/topup` (auth session + workspace):
1. Body `{ packageCode }`. Validate against the catalog.
2. Generate a unique `order_id` (e.g. `TU-{workspaceShort}-{timestamp}-{rand}`).
3. Insert a `payment_orders` row (`pending`, with `credits` + `amount_idr`).
4. Return `{ payment_url }` = `buildPaymentUrl(...)` with a `redirect` back to
   an app "payment result" page.

### 5. Webhook handler (grant credits)

Wire a Pakasir handler into `createBillingWebhookService`:
1. `parseWebhook` → `{ orderId, amount, status }`; ignore non-`completed`.
2. Look up the `payment_orders` row by `orderId`; if missing or already `paid`,
   no-op (idempotent).
3. `verifyTransaction({ amount, orderId })` against Pakasir; if not paid, mark
   the order `failed` and stop.
4. In one transaction: mark the order `paid`, and
   `appendCreditEntryInTransaction({ workspaceId, amount: credits,
   reason: 'topup', idempotencyKey: orderId, metadata: { orderId, amount_idr } })`.
   The ledger's unique `(workspace_id, idempotency_key)` makes double-grant
   impossible even if the webhook fires twice.

### 6. Payment result page (minimal)

A thin app route the Pakasir `redirect` returns to, that reads the order status
and shows "payment received / pending / failed". Full billing UI (balance,
history, packages page) is Plan 2 — Plan 1 ships only what's needed to complete
a purchase round-trip.

## Data flow (top-up)

1. User picks a top-up package → `POST /api/billing/topup` → gets `payment_url`.
2. Browser redirects to Pakasir hosted page; user pays (QRIS/VA).
3. Pakasir POSTs the webhook → we verify via detail API → grant credits in the
   ledger → mark order `paid`.
4. Pakasir redirects the user back to the result page, which shows success once
   the webhook has landed (poll the order status briefly if needed).

## Error handling

- Webhook with wrong `project`, unknown `order_id`, or failed verification →
  recorded and ignored; never grants credits.
- Duplicate webhook / double-fire → idempotent via `billing_webhook_events`
  and the ledger idempotency key; at most one grant per order.
- Top-up initiation unauthenticated → 401; no workspace → 403; missing Pakasir
  config → 503.
- Verification is authoritative: a spoofed webhook body cannot grant credits
  because step 3 re-checks with Pakasir using our server API key.

## Testing

- `pakasir` adapter unit tests: URL builder, webhook parse (reject wrong
  project), verify (mocked fetch: paid vs unpaid).
- `payment_orders` repository tests: workspace isolation, status transitions.
- Webhook handler tests (injected verifier/repo): completed→grant once,
  duplicate→no double grant, unpaid-per-detail→no grant, unknown order→no-op.
- Top-up route test: creates a pending order and returns a well-formed
  payment_url; auth/config error contract.

## Non-goals (Plan 1)

- Monthly subscription packages + `workspace_subscriptions` period management —
  Plan 2.
- COGS (OpenRouter `usage.cost`) tracking into the ledger — Plan 2.
- Full billing UI (balance widget, transaction history, packages page) — Plan 2
  ships the polished UI; Plan 1 ships only the minimal result page.
- Refunds / credit expiry / invoices.
