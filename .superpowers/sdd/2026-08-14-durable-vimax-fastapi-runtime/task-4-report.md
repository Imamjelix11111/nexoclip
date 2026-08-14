# Task 4 report — durable ViMax FastAPI boundary

## Red/green evidence

1. **RED:** added `nexoclip-app/tests/api/vimaxStoryboardJobRoute.test.mjs`; the focused command failed because `app/api/vimax/jobs/route.js` did not exist (`ERR_MODULE_NOT_FOUND`).
2. **GREEN:** added the authenticated structured route and ran:

   ```sh
   cd nexoclip-app && node --test tests/api/vimaxStoryboardJobRoute.test.mjs
   ```

   Result: **4 passed, 0 failed**. The tests prove server-derived workspace authorization, `createVimaxGenerationJobWithReservation` invocation, publish-after-reservation behavior, recovery-safe publication failure, and no publication after rejected admission.

## Changes

- `docker-compose.yml`
  - Added private, password-protected Redis 7 with AOF persistence, healthcheck, and `nexoclip-redis-data` volume. The development password fallback follows the existing Compose development database-password convention; production must set `REDIS_PASSWORD`.
  - Configured private FastAPI `ai-storyboard` health checks and a required server-only `VIMAX_RUNTIME_TOKEN`.
  - Added separate `nexoclip-storyboard-worker` using the existing BullMQ worker, database, private Redis URL, and runtime token.
  - Added server-only Redis configuration to the Next service. Redis and FastAPI have no published host ports.
- `nexoclip-app/app/api/vimax/jobs/route.js`
  - Added `POST /api/vimax/jobs`: authenticates from the session cookie, resolves the workspace from the server-side user context, reserves only through `createVimaxGenerationJobWithReservation`, then invokes existing queue recovery/publisher semantics after the reservation transaction has committed.
  - If immediate publication fails, returns the committed queued job (`202`); the worker startup/interval recovery publisher will safely publish it.
- `nexoclip-app/components/vimax/reused/api.ts`
  - Added typed `submitVimaxJob` client for explicit, structured durable submission.
- `nexoclip-app/components/vimax/reused/ViMaxApp.tsx`
  - Removed `startAgent` calls on initial refresh and session-open. Those paths now read legacy history/artifacts only.
  - No durable submission was invented from free-form chat: the current UI has no definite deterministic render control or structured render payload.
- `nexoclip-app/package.json`
  - Added `worker:storyboard` script.
- `nexoclip-app/tests/api/vimaxStoryboardJobRoute.test.mjs`
  - Added focused route tests.

## Verification

- `cd nexoclip-app && node --test tests/api/vimaxStoryboardJobRoute.test.mjs tests/queue/*.test.mjs tests/db/generationVimaxRuntimeMigration.test.mjs`
  - **43 passed, 0 failed**.
- `cd nexoclip-app/services/vimax && uv run pytest tests/test_runtime_api.py tests/test_vimax_adapters.py -q`
  - **32 passed**; one pre-existing Starlette/httpx deprecation warning.
- `cd nexoclip-app && npm run build`
  - **Passed**. It reports an existing optional BullMQ `@valkey/valkey-glide` resolution warning caused by BullMQ's optional client module.
- `VIMAX_RUNTIME_TOKEN=test-runtime-token docker compose -f docker-compose.yml config`
  - **Passed**. Confirmed Redis/FastAPI/worker have no host port publications and the worker uses internal `ai-storyboard:4173`.
- `VIMAX_RUNTIME_TOKEN=test-runtime-token docker compose -f docker-compose.yml build ai-storyboard nexoclip-storyboard-worker nexoclip-app`
  - Started, but did not finish within the 120-second command limit while pulling base-image metadata. No build-success claim is made.
- `git diff --check`
  - Passed.

## Staging choices

Staged only Task 4-owned content:

- New `nexoclip-app/app/api/vimax/jobs/route.js`
- New `nexoclip-app/tests/api/vimaxStoryboardJobRoute.test.mjs`
- Compose topology required by Task 4 (Redis, FastAPI health/token and tenant root, worker, app Redis dependency). The existing tenant-volume conversion was necessarily included because FastAPI’s configured `VIMAX_TENANTS_ROOT` is `/app/.tenants`; staging its supporting mount avoids a broken topology.
- The two `ViMaxApp.tsx` refresh/session-open removals only; the pre-existing textarea height change is intentionally left unstaged.
- `api.ts` durable job client and `package.json` worker script.

Unstaged unrelated user work remains in `styles.css`, auth/credit files, untracked credit files/tests, plan documents, and the preserved pre-existing ViMax textarea-height hunk.

## Commit

Task 4 changes are committed as `fix: complete durable storyboard boundary`.

## Concerns / follow-up

- Full legacy chat/session/history migration is explicitly deferred. Legacy bridge calls remain only for explicit interactive actions (new project, user chat submit, and user stop); reload/session-open no longer start or stop it.
- The UI has no deterministic existing render action with structured data, so it deliberately does **not** convert user free-form submit messages into durable render jobs. A future explicit render control must call `submitVimaxJob` and poll `GET /api/generations/:id`.
- Object storage/session persistence, provider reconciliation, cancellation propagation, and chat migration remain out of scope.
