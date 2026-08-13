# Sprint 1–3 Progress

## Task status

- [x] S3 — Production migration and runbook hardening

## S3 — Production migration and runbook hardening implementation note

- What changed: Added the production runbook, secret-safe environment example, fail-closed production configuration checker, queue recovery command boundary, and Docker runtime copies for migration/recovery tooling. Documented empty-database migration, API/worker startup boundaries, queue claim recovery, local object-storage limitations, MuAPI secret handling, release order, and rollback/non-decisions.
- Files: `docs/production-runbook.md`, `.env.example`, `scripts/production-config.mjs`, `scripts/worker-recover.mjs`, `Dockerfile`, `package.json`, `tests/production/productionConfig.test.mjs`, `docs/sprint-1-progress.md`.
- Tests: `node --test tests/production/productionConfig.test.mjs` — 3 passed, 0 failed after the expected red run for the missing configuration checker.
- Verification: Focused production configuration tests and existing queue publisher tests were run. Empty-database migration was not run because no disposable PostgreSQL service was available/started in this session; runbook commands are provided for that smoke test. Notion MCP reported 0 connected servers, so task synchronization was unavailable. No real secrets were added; the previous tracked value in `.env.example` was replaced with a placeholder.
- Blockers: No queue vendor/adapter or durable production object-storage adapter is selected; `worker:recover` intentionally fails closed until deployment injects a queue adapter. These are documented, not silently chosen.
- Follow-up: Add a deployment-specific persistent worker entrypoint and queue/object-storage adapters after those open architecture decisions are made.

- [x] Sprint 1 foundation and MuAPI/BYOK audit
- [x] Sprint 2 asynchronous generation pipeline foundations
- [x] S3 — Billing domain foundation and webhook boundary
- [x] S3 — Rate, concurrency, and budget limits
- [x] S3 — Admin usage, job, and credit audit views
- [x] S3 — Tenant isolation and security integration tests
- [x] S3 — SaaS image-generation workflow migration

## S3 — Tenant isolation and security integration tests implementation note

- What changed: Added Node built-in security integration coverage for cross-tenant denial, membership role propagation, admin audit authorization, workspace-scoped idempotency lookup, signed asset URL tamper/expiry rejection, production session cookie flags, provider-secret non-disclosure, and webhook signature rejection before persistence. Added the minimal asset-service guard so a missing tenant scope cannot reach the database.
- Files: `tests/security/tenantIsolation.integration.test.mjs`, `src/services/assetService.js`, `docs/sprint-1-progress.md`.
- Tests: `rtk node --test tests/security/tenantIsolation.integration.test.mjs` — 8 passed, 0 failed after the expected red run for the missing asset tenant guard.
- Verification: Full Node test regression and diff review run in the final session report. No real database, storage provider, payment provider, or MuAPI calls were used. Notion MCP was unavailable (0 servers), so task-board synchronization was not possible.
- Blockers: Route-level tests requiring Next.js runtime and live PostgreSQL fixtures remain deferred; RLS, payment integrations, UI, and unrelated schema work were intentionally not included.
- Follow-up: Add live PostgreSQL cross-tenant integration fixtures and route-handler tests when the deployment test harness is available.

## S3 — Admin usage, job, and credit audit views implementation note

- What changed: Added read-only `GET /api/admin/audit` views for generation jobs, provider usage/cost, and credit balance/ledger. Requests authenticate through the existing session, resolve the requested workspace through membership, and require owner/admin membership before repository access. Filters are allowlisted, pagination is bounded to 100 rows, SQL is parameterized, and audit projections omit prompts, result/error payloads, and provider `raw_usage`.
- Files: `app/api/admin/audit/route.js`, `src/services/adminAuditService.js`, `src/repositories/adminAuditRepository.js`, `tests/admin/adminAudit.test.mjs`.
- Tests: `node --test tests/admin/adminAudit.test.mjs` — 3 passed, 0 failed after the expected red run before implementation.
- Verification: Focused and regression verification recorded in the final session report. Notion MCP unavailable (0 servers), so task-board synchronization was not possible.
- Blockers: No UI was added; deployment still needs an admin-facing client and database integration fixture for live-query coverage.
- Follow-up: Add route-level integration tests with a session/membership fixture and connect an internal admin UI in a later task.

## S3 — Rate, concurrency, and budget limits implementation note

- What changed: Added tenant-scoped, provider-neutral generation admission limits with PostgreSQL row locking, configurable rate window, active-generation cap, and calendar-month credit budget. Generation creation checks limits after idempotency lookup and before credit reservation; worker claims honor the concurrency cap. Errors expose bounded codes/statuses without provider details. Compatibility routes remain unchanged.
- Files: `src/db/migrations/016_generation_limits.sql`, `src/repositories/generationLimitsRepository.js`, `src/services/generationService.js`, `src/queue/generationWorker.js`, `app/api/generations/route.js`, `tests/generations/generationLimits.test.mjs`, `tests/db/generationLimitsMigration.test.mjs`.
- Tests: `node --test tests/generations/generationLimits.test.mjs tests/db/generationLimitsMigration.test.mjs` — 4 passed, 0 failed after the expected red run before implementation.
- Verification: Regression command and syntax/diff checks are recorded in the final session report. Notion MCP unavailable (0 servers), so task-board synchronization was not possible.
- Blockers: Existing workspaces have no default limit row until configured; absence means limits are disabled, preserving reversibility. No external rate-limit dependency, billing integration, admin UI, RLS, or unrelated schema was added.
- Follow-up: Configure workspace limit rows in deployment/admin provisioning and add PostgreSQL concurrency integration coverage when the deployment fixture is available.

## S3 — SaaS image-generation workflow migration implementation note

- What changed: Added the provider-neutral image worker handler that submits through the server-side MuAPI adapter, downloads outputs into injected object storage, creates tenant-scoped asset metadata, persists output links, and keeps credit settlement in the existing worker. Added SaaS image submission/status polling to the image studio behind an explicit `nexoclip_workspace_id` session value; no BYOK/Electron route changed.
- Files: `src/services/saasImageGeneration.js`, `src/repositories/assetMetadataRepository.js`, `src/services/generationService.js`, `src/repositories/generationRepository.js`, `app/api/generations/[generationId]/route.js`, `packages/studio/src/muapi.js`, `packages/studio/src/components/ImageStudio.jsx`, `components/StandaloneShell.js`, tests, `docs/production-runbook.md`.
- Tests: `node --test tests/generations/saasImageGeneration.test.mjs tests/generations/generationService.test.mjs` — 5 passed, 0 failed after the expected red run.
- Verification: Focused tests passed; full Node regression passed (97 tests), `npm run build` passed, `npm run config:check` passed, and `git diff --check` passed. `npm run db:migrate` was attempted but correctly stopped because `DATABASE_URL` is not configured; no database was available. Notion MCP was unavailable (0 servers), so task synchronization was unavailable.
- Blockers: The repository still has no selected production queue/object-storage adapter or worker entrypoint; local end-to-end deployment remains intentionally deferred. The client requires the existing authenticated shell to set `nexoclip_workspace_id`.
- Follow-up: Wire workspace/session selection to the authenticated SaaS shell and add a deployment-specific worker entrypoint after queue and storage providers are selected.

## Sprint 4 — SaaS frontend auth shell Task 1 implementation note

- What changed: Added the same-origin `saasFetch` helper with cookie credentials, JSON negotiation, structured safe HTTP/network errors, and rejection of provider credential headers. Added SSR-safe session-storage persistence for a workspace selector only.
- Files: `src/lib/saas/api.js`, `src/lib/saas/storage.js`, `tests/frontend/saasApi.test.mjs`, `docs/sprint-1-progress.md`.
- Tests: `node --test tests/frontend/saasApi.test.mjs` — 5 passed, 0 failed after the expected red run before implementation.
- Verification: Focused test command passed. `rtk git diff --check` and `rtk git diff` review are required for final session verification. Notion MCP was unavailable (0 connected servers), so task synchronization was unavailable.
- Blockers: No blockers for Task 1. The existing repository emits Node's module-type warning because package metadata does not declare ESM; no package-wide change was made for this focused task.
- Follow-up: Use these utilities from the session/workspace provider in Sprint 4 Task 3; do not add provider credentials or API-key persistence to hosted frontend code.

## Sprint 4 — SaaS frontend auth shell Task 2 implementation note

- What changed: Added minimal local shadcn-style React primitives for buttons, inputs, labels, cards, badges, alerts, skeletons, and separators, plus loading, empty, error, and unauthorized SaaS state components. Components use native accessible elements, preserve className passthrough, expose focus-visible styles, and support disabled/loading buttons without adding dependencies.
- Files: `components/ui/button.js`, `components/ui/input.js`, `components/ui/label.js`, `components/ui/card.js`, `components/ui/badge.js`, `components/ui/alert.js`, `components/ui/skeleton.js`, `components/ui/separator.js`, `components/saas/states.js`, `docs/sprint-1-progress.md`.
- Tests: No new test file was added because this task is limited to presentational primitives and the repository has no configured React component test runner; build verification exercised compilation and static validation.
- Verification: `npm run build` — passed; Next.js compiled successfully, generated 19 static pages, and produced the route summary. `git diff --check` — passed. `git diff` review performed for tracked changes; newly created files were inspected directly. No dependencies, legacy components, provider credentials, or API-key handling were added.
- Blockers: Notion MCP was unavailable (0 connected servers), so task synchronization was not possible. Existing package metadata still emits no additional task-specific blocker.
- Follow-up: Compose these primitives in the Sprint 4 session provider, auth forms, protected shell, and dashboard tasks without adding a UI framework or provider credentials.

## Sprint 4 — SaaS frontend auth shell Task 3 implementation note

- What changed: Added the client SaaS provider and testable session/workspace state helpers. Session is fetched first; workspace data is requested only for authenticated sessions. A stored workspace selector is restored only when it belongs to the returned membership list, otherwise the first workspace is selected. The provider exposes status, user, workspaces, selected workspace, refresh, selection, and logout; logout POSTs to the existing endpoint and clears selector storage. Unauthorized responses reset to unauthenticated state, and user-facing errors are bounded and provider-secret-free.
- Files: `components/saas/SaaSProvider.js`, `tests/frontend/saasProvider.test.mjs`, `docs/sprint-1-progress.md`.
- Tests: `node --test tests/frontend/saasProvider.test.mjs` — 6 passed, 0 failed after the expected red run for the missing provider module.
- Verification: Build, focused provider tests, frontend API tests, configuration check, and diff checks are recorded in the final session report. No credentials or provider headers are used by the provider. Notion MCP was unavailable (0 connected servers), so task synchronization was unavailable.
- Blockers: Existing package metadata emits Node's module-type warning for direct ESM test imports; no package-wide metadata change was made for this focused task. No live auth/database service was used.
- Follow-up: Consume `useSaaS()` from the protected route shell and connect auth forms without persisting session tokens or provider credentials.

## Sprint 4 — SaaS frontend auth shell Task 4 implementation note

- What changed: Added shared client login/register form behavior with email/password validation, loading state, bounded user-facing errors, same-origin credentialed POSTs through `saasFetch`, and success navigation to `/app/dashboard`. Added public `/login` and `/register` route-group pages with links between auth modes and an explicit legacy `/studio` link. No session token, provider key, BYOK value, or provider credential header is read or stored.
- Files: `components/saas/AuthForm.js`, `src/lib/saas/authForm.js`, `app/(auth)/login/page.js`, `app/(auth)/register/page.js`, `tests/frontend/authForm.test.mjs`, `docs/sprint-1-progress.md`.
- Tests: `node --test tests/frontend/authForm.test.mjs` — 2 passed, 0 failed after the expected red run for the missing form helper.
- Verification: `npm run build` — passed; Next.js compiled successfully and generated `/login` and `/register`. `node --test tests/frontend/*.test.mjs` — 13 passed, 0 failed. `npm run config:check` — passed. `rtk git diff --check` — passed. No real auth/database service or provider credentials were used.
- Blockers: Notion MCP was unavailable (no matching Notion tools/connected server), so task synchronization was not possible; no live auth/database fixture was used.
- Follow-up: Integrate the auth routes with `SaaSProvider`/protected shell in the next approved frontend task.

## Sprint 4 — SaaS frontend auth shell Task 6 implementation note

- What changed: Added the protected SaaS dashboard with a welcome card, selected workspace summary, explicit capability cards, available/coming-soon links, a no-workspace onboarding state, and a safe retryable error state wired to the SaaS provider refresh. The legacy `/studio` link remains separate and unchanged.
- Files: `app/(saas)/dashboard/page.js`, `tests/frontend/dashboard.test.mjs`, `docs/sprint-1-progress.md`.
- Tests: `node --test tests/frontend/dashboard.test.mjs` — 1 passed, 0 failed after the expected red run for the missing dashboard page.
- Verification: Build, frontend regression, configuration check, and diff checks are recorded in the final session report. No provider credentials or workspace data was fabricated client-side.
- Blockers: Notion MCP was unavailable (0 connected servers), so task synchronization was not possible. No live auth/database service was used.
- Follow-up: Connect the dashboard capability links as Projects, Assets, and Generations are implemented; retain `/studio` as the compatibility path.

## Sprint 4 — SaaS frontend auth shell Task 7 implementation note

- What changed: Added hosted frontend security scans for provider-secret/path leakage and route regression coverage for the existing auth API paths, canonical `/app/dashboard` route, and preserved `/studio`. Corrected the route-group mismatch by moving the SaaS dashboard from `app/(saas)/dashboard/page.js` to `app/(saas)/app/dashboard/page.js` and updated its relative imports and dashboard test.
- Files: `tests/frontend/security.test.mjs`, `tests/frontend/routes.test.mjs`, `tests/frontend/dashboard.test.mjs`, `app/(saas)/app/dashboard/page.js` (moved from `app/(saas)/dashboard/page.js`), `docs/sprint-1-progress.md`.
- Tests: `node --test tests/frontend/*.test.mjs` — 21 passed, 0 failed after the expected red run for the missing canonical route and security scan.
- Verification: `npm run build` — passed; Next.js generated `/app/dashboard` and preserved `/studio/[[...slug]]`. `npm run config:check` — passed. `rtk git diff --check` — passed. The frontend test run emitted the repository's existing Node `MODULE_TYPELESS_PACKAGE_JSON` warnings for direct ESM imports; no package-wide metadata change was made.
- Blockers: Notion MCP was unavailable (0 connected servers), so task synchronization was not possible. No live auth/database service or provider credentials were used.
- Follow-up: Connect the remaining SaaS capability routes when implemented; retain the explicit `/studio` compatibility path.

## Sprint 4 — SaaS frontend auth shell Task 5 implementation note

- What changed: Added the protected SaaS route layout, authentication gate with loading/unauthorized/error states and `/login` redirect, accessible native workspace selector, responsive desktop collapsible sidebar/mobile drawer, navigation for Dashboard/Projects/Assets/Generations/Settings with unavailable routes explicitly marked, Legacy Studio link, and header logout action. The route group is wrapped in `SaaSProvider`; legacy `/studio` files were not changed.
- Files: `components/saas/ProtectedRoute.js`, `components/saas/WorkspaceSwitcher.js`, `components/saas/SaaSAppShell.js`, `app/(saas)/layout.js`, `tests/frontend/saasShell.test.mjs`, `docs/sprint-1-progress.md`.
- Tests: `node --test tests/frontend/saasShell.test.mjs` — 4 passed, 0 failed after the expected red run for missing shell files.
- Verification: `npm run build` — passed; Next.js compiled successfully and generated 21 static pages. `node --test tests/frontend/*.test.mjs` — 17 passed, 0 failed. `npm run config:check` — passed. `git diff --check` — passed. Final status/diff review confirmed only the requested new shell files and progress note were touched by this task; unrelated working-tree changes were preserved. No provider credentials or API-key handling was added.
- Blockers: Notion MCP was unavailable (0 connected servers), so task synchronization was not possible. No live auth/database service was used; the protected route depends on the existing session/workspace APIs.
- Follow-up: Add the approved SaaS dashboard route and connect unavailable navigation destinations as their capabilities are implemented.

## Sprint 4 — SaaS frontend auth shell Task 8 final verification note

- What changed: Final verification only; no auth/shell implementation files changed. Reviewed the hosted auth, provider, shell, dashboard, UI, SaaS utility, and frontend test files. Preserved unrelated working-tree changes and untracked `AGENTS.md`.
- Files: `docs/sprint-1-progress.md`.
- Tests: `node --test tests/frontend/*.test.mjs` — 21 passed, 0 failed; existing Node `MODULE_TYPELESS_PACKAGE_JSON` warnings were emitted for direct ESM imports.
- Verification: `npm run build` — passed; Next.js compiled, generated 22 static pages, and included `/login`, `/register`, `/app/dashboard`, and preserved `/studio/[[...slug]]`. `npm run config:check` — passed (`Production environment configuration is valid.`). `git diff --check` — passed. Hosted SaaS scan over `app/(auth)`, `app/(saas)`, `components/saas`, `src/lib/saas`, and `tests/frontend` found no `MUAPI_API_KEY`, MuAPI key, `x-api-key`, authorization/provider-key pattern, or direct MuAPI import; the frontend security test also passed.
- Blockers: Notion MCP reported 0 connected servers/0 tools, so no matching task status or implementation note could be synchronized. No live auth/database service was used. The repository's existing ESM module-type warnings remain unchanged.
- Follow-up: Keep provider secrets server/worker-only; connect future SaaS capability routes without changing `/studio` compatibility behavior.

## Sprint 4 — SaaS login end-to-end verification

- What changed: Inspected the existing login UI/API/session flow and added a PostgreSQL-backed login/session integration test. The existing implementation already uses `/api/auth/login`, hashes passwords with scrypt, creates an opaque random session token while storing only its SHA-256 hash, applies the HttpOnly session cookie, returns a safe invalid-credentials response, and redirects the shared auth form to `/app/dashboard`. Register, protected session loading, and legacy `/studio` paths were preserved; no project/assets/package adapter work was started.
- Files: `tests/auth/loginRoute.integration.test.mjs`, `docs/sprint-1-progress.md`.
- Tests: `DATABASE_URL='postgres://nexoclip:nexoclip_dev@localhost:5434/nexoclip' node --test tests/auth/loginRoute.integration.test.mjs` — 2 passed, 0 failed. The test creates a temporary uniquely named user, verifies case-normalized login, opaque token/session lookup, safe wrong-password rejection, and route source guarantees for `401`, cookie assignment, and safe error text; cleanup deletes the temporary user and cascading session/workspace records.
- Verification: `node --test tests/auth/*.test.mjs tests/frontend/*.test.mjs` — 33 passed, 0 failed. `DATABASE_URL='postgres://nexoclip:nexoclip_dev@localhost:5434/nexoclip' npm run db:migrate` — migrations applied. `npm run build` — passed; Next.js compiled and generated `/login`, `/register`, `/app/dashboard`, `/api/auth/login`, `/api/auth/session`, and preserved `/studio/[[...slug]]`. `npm run config:check` — passed (`Production environment configuration is valid.`). `rtk git diff --check` — passed. Tests emitted the existing `MODULE_TYPELESS_PACKAGE_JSON` warning; no package-wide metadata change was made.
- Blockers: Direct importing of Next route handlers under plain `node --test` is not supported by the installed Next package's extensionless `next/server` resolution, so the focused test exercises the real auth service/database path and statically verifies the route boundary. A live browser/server HTTP test was not run. Notion MCP was unavailable (server not connected), so task synchronization was not possible.
- Follow-up: Add a Next-runtime/browser HTTP smoke test when the repository test harness supports route-handler execution; keep `/studio` compatibility and do not begin project/assets/package adapter work in this login task.
