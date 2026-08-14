# Task 4 fix report — durable ViMax FastAPI runtime

## Implemented boundary fixes

- Added `nexoclip-migrate`, a one-shot Compose service running `npm run db:migrate` after PostgreSQL health. Both `nexoclip-app` and `nexoclip-storyboard-worker` now require it to complete successfully.
- Required `REDIS_PASSWORD` with `${REDIS_PASSWORD:?REDIS_PASSWORD is required}` everywhere Compose config consumes it. Redis, FastAPI runtime, worker, and Next runtime publish no host ports; PostgreSQL remains locally exposed.
- Replaced the generic legacy proxy behavior with a read-only GET allowlist: `sessions`, `history`, `artifacts`, `artifact`, and `models`. Every legacy write returns 410 before authentication/upstream work; unknown reads return 404.
- Added authenticated `GET /api/vimax/jobs/:generationId`. It derives the workspace exclusively from the authenticated server session/default workspace and ignores browser workspace headers.
- Logged deferred queue publication as a token-safe structured event containing only event name, durable job ID, error name, and error code. Durable admission still returns 202 after a committed reservation.
- Connected the UI render action to durable admission. It submits exactly the durable render payload with `crypto.randomUUID()`, stores the returned job ID per session in localStorage, restores it for the selected session, polls the authenticated ViMax status route, and displays status.
- Disabled legacy bridge-dependent chat, agent, upload, model, and project-creation controls with explicit migration messaging. No render action calls the blocked legacy start/message/stop routes.

## TDD evidence

1. Added legacy proxy tests first. They initially failed because `createLegacyVimaxProxyHandler` was not exported; implemented the allowlist boundary, then the test passed.
2. Added authenticated status route tests first. They initially failed because the ViMax status route did not exist; implemented server-derived workspace lookup, then the test passed.
3. Changed the publication-failure test first to require a structured safe log. It failed with an empty log array; added logging and the test passed.

## Verification

- `cd nexoclip-app && node --test tests/api/vimaxLegacyBoundaryRoute.test.mjs tests/api/vimaxJobStatusRoute.test.mjs tests/api/vimaxStoryboardJobRoute.test.mjs`
  - 8 tests passed, 0 failed.
- `cd nexoclip-app && npm run build`
  - completed successfully. Existing optional BullMQ `@valkey/valkey-glide` resolution warning remains during compilation.
- `REDIS_PASSWORD=test VIMAX_RUNTIME_TOKEN=test docker compose config`
  - completed successfully; rendered configuration contains migration completion dependencies and no runtime host-port binding.
- `git diff --check`
  - no whitespace errors.

## Concerns

- Focused tests cover route contracts and deferred publication logging. The UI is type/build checked; this repository has no existing React component test harness for browser localStorage/polling interaction tests.
- The pre-existing optional BullMQ Valkey Glide module warning is unrelated to this task and does not cause the build to fail.
