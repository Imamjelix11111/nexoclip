# AI Storyboard OpenRouter Usage Credits Design

## Goal
Meter actual OpenRouter usage for AI Storyboard without charging a flat amount per message, then settle the existing workspace credit ledger in credits.

## Pricing
- One credit equals USD 0.01 of billable provider cost.
- Convert cost to credits with `costUsd * 100`, rounded up to one decimal credit.
- MVP margin is 0%.
- The initial workspace grant is 100 onboarding credits.

## Metering model
- Agent LLM and text revisions: capture actual LangChain/OpenRouter usage for each provider call. Ordinary messages are charged only when they actually invoke the model; local/status operations cost zero.
- Images: capture OpenRouter adapter `usage.cost`; use a server-side fallback price only when provider usage omits cost.
- Seedance video: reserve a bounded maximum before job creation. Capture actual usage after polling succeeds, refund unused reserved credits, and release all reservation on failed/cancelled jobs.
- Embedding and reranking: record usage if available but charge zero while the selected OpenRouter models are free.

## Credit flow
1. Before a billable provider call, calculate a bounded maximum provider cost and reserve the matching credits using the existing workspace ledger.
2. Execute the provider action and record sanitized usage, model, action/session/scene metadata, and provider request ID.
3. On success, convert actual cost to credits and capture/refund the reservation difference idempotently.
4. On failure or cancellation, release the reservation idempotently.
5. Do not charge when no provider action is run.

## Boundaries
- Nexoclip Node/Postgres owns balances, reservations, settlement, usage records, onboarding grants, and admin/CLI credit grants.
- ViMax remains the Python orchestration service and reports metering events to a private authenticated Nexoclip internal API. It must not directly write the billing database.
- `OPENROUTER_API_KEY` remains server-only and is never returned by metering endpoints.
- Only Agent LLM and Image model selection remain user-configurable. Video, embedding, and reranker stay fixed OpenRouter models.

## Interfaces
- Private internal endpoints accept a trusted service credential plus authenticated workspace/tenant identity:
  - reserve usage
  - capture usage
  - release usage
- Each request has an idempotency key scoped to workspace, action, provider request, and attempt.
- The endpoint returns a reservation ID and remaining balance; ViMax uses it to settle or release.

## UI
- Show current workspace credit balance in the AI Storyboard header/composer.
- Before expensive image/video actions, display a server estimate when available.
- After completion, show credits used/refunded from the settlement event.
- No user-facing API key, base URL, provider, or raw token/cost data.

## Admin and CLI
- A workspace gets one idempotent 100-credit onboarding grant at creation.
- Admin can append a positive/negative adjustment with a reason and idempotency key.
- A protected CLI command uses the same service/ledger API and prints the resulting balance.

## Error handling
- If credit reservation fails for insufficient balance, do not invoke OpenRouter.
- If usage cannot be retrieved after a successful provider call, retain the reservation for reconciliation rather than silently refunding.
- All raw provider usage is sanitized before persistence or logs.

## Validation
- Unit tests cover USD-to-credit rounding, idempotent reserve/capture/release, failure refund, missing actual cost, and zero-cost providers.
- Integration tests cover internal API authentication and tenant/workspace isolation.
- Existing generation-credit tests remain passing.
