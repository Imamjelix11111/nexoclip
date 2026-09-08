# Task 12 Report — Placeholder Ownership Migration

## Status
Implemented.

## Exact brief applied
- One-shot script only receives both DB URLs.
- Long-running services keep only their own DB credential.
- `SPITE_OWNER_USER_ID` is required in production.
- Deterministic first-user fallback is allowed only when deliberately configured.
- Placeholder-owned SPITE projects are updated transactionally with a completion marker.
- Migration is idempotent.
- Tests use dependency-injected adapters and were written first.

## Changed files
- `nexoclip-app/scripts/migrate-spite-ownership.mjs`
- `nexoclip-app/tests/realtime/spiteOwnershipMigration.test.mjs`
- `nexoclip-app/.env.production.example`
- `nexoclip-app/tests/deployment/dockerDeployment.test.mjs`

## Verification
- `cd nexoclip-app && rtk test node --test tests/realtime/spiteOwnershipMigration.test.mjs tests/deployment/dockerDeployment.test.mjs`

## Notes
- Migration marker key: `spite.placeholder-ownership.v1`
- Placeholder owner UUID: `00000000-0000-0000-0000-000000000001`
- Production run command: `cd nexoclip-app && DATABASE_URL_NEXOCLIP=... DATABASE_URL_SPITE=... SPITE_OWNER_USER_ID=... node scripts/migrate-spite-ownership.mjs`

## Concerns
- The script assumes the main auth database still exposes the canonical `users` table with `created_at` ordering when deterministic fallback is explicitly enabled.
- Existing malformed marker payloads are treated as absent and will be replaced by a fresh successful run.
