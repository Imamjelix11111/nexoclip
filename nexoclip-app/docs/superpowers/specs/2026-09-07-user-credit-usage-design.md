# User Credit and Usage Visibility Design

## Goal

Make SaaS credit consumption understandable to each signed-in user. Users can see their current workspace balance, the estimated credit cost before generation, and a history of their own usage. Workspace owners and admins can additionally inspect workspace-wide usage.

## Scope

This feature covers only SaaS generations that use the central credit reservation and settlement flow. BYOK and direct-provider compatibility routes are out of scope.

The primary unit shown in the UI is **credits**. Provider units such as tokens, images, seconds, or other usage metadata are shown only when `provider_usage.units` contains them. Provider currency cost remains internal and is not presented as a user-facing price.

## Product behavior

### Global balance

The Studio header displays a compact clickable balance pill, for example `◈ 840 credits`. Clicking it navigates to `/studio/usage`.

The balance is workspace-level because the existing credit account belongs to a workspace. It refreshes when the Studio session loads, when the active workspace changes, and after a SaaS generation completes or fails.

If balance loading fails, the pill shows `Credits unavailable` without blocking Studio use. It must not display stale data as if it were current.

### Cost before generation

Supported SaaS generation controls show the current estimate in credits, for example `Generate · 8 credits`. The server remains authoritative: it resolves the active pricing version, validates limits and balance, reserves credits, and creates the job in one transaction.

When a job is accepted, the reserved amount immediately reduces the workspace balance. A failed or canceled job releases the reservation. A successful job captures the actual charge and refunds any difference between reserved and actual cost. If actual provider cost is unavailable, settlement uses the estimate.

### Usage page

`/studio/usage` follows the approved compact-header layout. It contains:

- Current workspace credit balance.
- Credits used in the current UTC calendar month.
- Generation count in the current UTC calendar month.
- A paginated history table with creation time, generation kind/prompt label, model, status, provider units when available, and credits.
- `My usage` for every member.
- `Workspace usage` only for workspace owners and admins.

A running generation displays its reserved estimate as `N est.`. A settled generation displays its final charged credits derived from the credit ledger: the original negative reservation plus any positive capture adjustment. Failed or canceled generations whose reservation was fully released display `0`. Provider `actual_cost` is not used as a credit amount because it may be denominated in provider currency rather than NexoClip credits.

Historical generation rows without an actor are excluded from `My usage` and remain visible in `Workspace usage`.

## Authorization and ownership

A new nullable `created_by_user_id` foreign key is added to `generation_jobs`. New authenticated SaaS generation jobs always set it from the resolved server session. The client cannot supply or override this value.

Usage reads are tenant-scoped:

- `scope=me` filters by both `workspace_id` and the authenticated `user_id`.
- `scope=workspace` filters by `workspace_id` and requires membership role `owner` or `admin`.
- Cross-workspace access is rejected before any usage query runs.

The column remains nullable so existing rows and deployments can migrate without inventing ownership.

## API

### `GET /api/usage`

Request headers:

- `x-workspace-id` — required workspace selected by the client.

Query parameters:

- `scope=me|workspace`, default `me`.
- `page`, default `1`.
- `pageSize`, default `25`, maximum `100`.

Response:

```json
{
  "balance": "840.000000",
  "summary": {
    "creditsUsed": "160.000000",
    "generationCount": 23,
    "periodStart": "2026-09-01T00:00:00.000Z"
  },
  "permissions": { "canViewWorkspace": true },
  "items": [
    {
      "id": "generation-id",
      "createdAt": "2026-09-07T10:00:00.000Z",
      "kind": "image",
      "prompt": "Product photo",
      "model": "flux-pro",
      "status": "succeeded",
      "provider": "muapi",
      "credits": "8.000000",
      "estimated": false,
      "units": { "images": 1 }
    }
  ],
  "pagination": { "page": 1, "pageSize": 25, "total": 23, "totalPages": 1 }
}
```

The API returns credits as decimal strings to avoid floating-point formatting errors. It does not expose `raw_usage`, provider credentials, or provider monetary cost.

### Image generation execution boundary

The Image Studio SaaS flow uses `POST /api/generations`, not the browser-facing OpenRouter compatibility route. The route reserves credits and creates a durable job, then publishes it to the external queue after the transaction commits. A persistent image worker claims the job, calls the existing server-only provider router, persists output assets and provider usage, and settles the reservation.

OpenRouter is the primary image provider. Existing direct-provider fallback mapping remains the sole fallback policy: OpenAI, Gemini, or BytePlus is attempted only for mapped models and retryable/model-routing failures. If a mapped direct provider is not configured, the worker fails safely and releases the reservation. Browser code never reads, transmits, or receives provider credentials.

### Estimate source

No duplicate client pricing table is introduced. The UI obtains an estimate from the same server-side pricing logic used during reservation through `/api/generations/estimate`.

## Data and query design

A migration adds:

```sql
ALTER TABLE generation_jobs
  ADD COLUMN created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX generation_jobs_workspace_user_created_idx
  ON generation_jobs (workspace_id, created_by_user_id, created_at DESC);
```

Usage history joins `generation_jobs` to `provider_usage` for provider/unit metadata and to `credit_ledger` for credit accounting. Credit display uses one canonical expression: pending jobs show `estimated_cost`; captured jobs calculate the net charge from the reservation ledger entry plus settlement adjustment entries whose metadata references the generation; released/refunded jobs show zero. Summary calculation uses the same expression so cards and rows cannot disagree. Provider `actual_cost` remains provider-accounting data and is never treated as credits without an explicit conversion.

The current workspace balance comes from `credit_accounts`. A missing account is represented as zero.

## Frontend integration

`StandaloneShell` gains a `usage` tab/content component and treats `/studio/usage` like existing Studio routes. The existing header balance control is reused rather than adding a second balance widget. Its current dollar formatting is replaced with credit formatting and it becomes a link/button to Usage.

A focused `UsageContent` client component fetches `/api/usage`, owns scope and pagination state, and renders loading, empty, error, and populated states. It follows the current dark Studio styling and remains usable on narrow screens via horizontal table scrolling.

Generation controls integrate estimates incrementally only for SaaS-backed generation paths. Compatibility/direct paths are not labeled with a credit estimate.

## Error handling

- Missing or invalid workspace: `400`.
- Missing session: `401`.
- Workspace membership denied: `403`.
- Non-admin requesting workspace scope: `403` with a stable error code.
- Invalid pagination or scope: `400`.
- Missing pricing rule: generation estimate is unavailable and generation remains blocked by the existing server validation.
- Usage UI errors provide a retry action and do not log or render sensitive provider payloads.

## Testing and verification

Automated tests cover:

1. Migration structure and nullable historical ownership.
2. Generation creation stores the authenticated user ID and ignores client ownership input.
3. `scope=me` excludes another member's jobs in the same workspace.
4. A regular member cannot request workspace scope.
5. Owner/admin workspace scope includes actorless historical rows.
6. Summary and row charges handle reserved, captured, released, and missing actual-cost states.
7. Provider units are returned while raw provider usage is not.
8. Header balance and Usage states render correctly.
9. Existing generation reservation, settlement, and tenant-isolation tests continue to pass.

Verification commands use the repository's existing Node test runner, followed by `rtk npm run build` and `rtk git diff`. The final diff must contain no secrets.

## Deliberate exclusions

- BYOK/direct-provider usage.
- Currency conversion or approximate USD/IDR display.
- Purchasing/top-up UI.
- Charts, exports, custom date ranges, and usage alerts.
- Per-user credit wallets; balance remains workspace-level.
- Backfilling ownership for historical jobs.
