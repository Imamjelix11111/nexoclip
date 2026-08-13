# SaaS Frontend Auth and Application Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first hosted NexoClip SaaS frontend slice: authentication, session restoration, workspace selection, responsive SaaS shell, and dashboard while preserving `/studio`.

**Architecture:** Add App Router route groups for public auth and protected SaaS pages. A client-side session provider calls existing same-origin auth/workspace APIs with cookies; a workspace context stores only the selected workspace identifier while server membership remains authoritative. A small local shadcn-style component set supplies accessible UI primitives without adding a UI framework.

**Tech Stack:** Next.js 15 App Router, React 19, JavaScript ES modules, Tailwind CSS existing setup, Node built-in `node:test`, mocked `fetch`/router boundaries.

## Global Constraints

- Preserve existing MuAPI/BYOK compatibility routes and `/studio` behavior.
- Hosted SaaS frontend must never read, store, or send `MUAPI_API_KEY`, `x-api-key`, or provider credentials.
- Use existing `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout`, and `GET /api/workspaces` routes.
- Session tokens remain HttpOnly server cookies; client code only observes safe session data.
- Client `workspace_id` is a selector only; server membership is authorization.
- Use minimal shadcn-style local components; do not add a large UI dependency.
- Keep missing capabilities explicitly disabled/coming-soon instead of silently falling back to BYOK.
- Preserve unrelated working-tree changes; do not modify or delete `AGENTS.md`.

---

## File map

### Create

- `app/(auth)/login/page.js` — login page entry.
- `app/(auth)/register/page.js` — registration page entry.
- `app/(saas)/layout.js` — protected SaaS layout entry.
- `app/(saas)/dashboard/page.js` — dashboard page.
- `components/saas/SaaSProvider.js` — session and workspace client state.
- `components/saas/SaaSAppShell.js` — responsive shell and navigation.
- `components/saas/WorkspaceSwitcher.js` — selected workspace control.
- `components/saas/AuthForm.js` — shared login/register form behavior.
- `components/saas/ProtectedRoute.js` — authenticated content gate.
- `components/saas/states.js` — loading, empty, error, unauthorized state components.
- `components/ui/button.js`, `input.js`, `label.js`, `card.js`, `badge.js`, `alert.js`, `skeleton.js`, `separator.js` — minimal local primitives.
- `src/lib/saas/api.js` — safe same-origin SaaS fetch helper.
- `src/lib/saas/storage.js` — non-secret workspace selector persistence.
- `tests/frontend/saasApi.test.mjs` — API helper contract tests.
- `tests/frontend/saasProvider.test.mjs` — session/workspace state tests.
- `tests/frontend/security.test.mjs` — hosted frontend secret/path scan tests.

### Modify

- `app/globals.css` — only if required for shell/UI tokens; preserve existing styles.
- `app/layout.js` — only if route-wide provider or metadata integration is required.
- `package.json` — only if a test script or already-required dependency is needed; avoid new UI dependencies.

## Interfaces

`src/lib/saas/api.js` exposes:

```js
export async function saasFetch(path, options = {})
// Returns parsed JSON for 2xx responses.
// Throws error { code, status, message } for non-2xx/network failures.
// Always uses same-origin requests and credentials: 'include'.
```

`components/saas/SaaSProvider.js` exposes context value:

```js
{
  status: 'loading' | 'authenticated' | 'unauthenticated' | 'error',
  user: { id, email, displayName } | null,
  workspaces: Array,
  workspaceId: string | null,
  workspace: object | null,
  selectWorkspace(id): void,
  refresh(): Promise<void>,
  logout(): Promise<void>,
  error: string | null,
}
```

`components/saas/ProtectedRoute.js` consumes the provider and renders children only for `authenticated`; it redirects unauthenticated users to `/login`.

---

### Task 1: Add safe SaaS API and selector utilities

**Files:**
- Create: `src/lib/saas/api.js`
- Create: `src/lib/saas/storage.js`
- Test: `tests/frontend/saasApi.test.mjs`

- [ ] **Step 1: Write failing API tests** for credentials inclusion, JSON success, structured HTTP errors, network errors, and no API-key headers.
- [ ] **Step 2: Run** `node --test tests/frontend/saasApi.test.mjs`; expect failures because the helper does not exist.
- [ ] **Step 3: Implement** `saasFetch` with same-origin path validation, `credentials: 'include'`, JSON content negotiation, safe error mapping, and no provider-header support.
- [ ] **Step 4: Implement** selector storage using `sessionStorage` or `localStorage` only for a workspace ID, with SSR guards and invalid-value removal.
- [ ] **Step 5: Run** `node --test tests/frontend/saasApi.test.mjs`; expect PASS.

### Task 2: Build shared shadcn-style primitives and state components

**Files:**
- Create: `components/ui/button.js`, `components/ui/input.js`, `components/ui/label.js`, `components/ui/card.js`, `components/ui/badge.js`, `components/ui/alert.js`, `components/ui/skeleton.js`, `components/ui/separator.js`
- Create: `components/saas/states.js`

- [ ] **Step 1: Implement** small React components with native semantic elements, className passthrough, disabled/loading support, and visible focus styles.
- [ ] **Step 2: Implement** `LoadingState`, `EmptyState`, `ErrorState`, and `UnauthorizedState` using the primitives and safe user-facing copy.
- [ ] **Step 3: Run** `npm run build`; expect the components to compile without adding a UI dependency.

### Task 3: Implement session and workspace provider

**Files:**
- Create: `components/saas/SaaSProvider.js`
- Test: `tests/frontend/saasProvider.test.mjs`

- [ ] **Step 1: Write failing tests** for initial loading, session false response, authenticated session followed by workspace loading, selected-workspace restoration, workspace selection, logout, and 401 reset behavior.
- [ ] **Step 2: Run** `node --test tests/frontend/saasProvider.test.mjs`; expect failures.
- [ ] **Step 3: Implement** a client provider that calls session first, calls workspaces only when authenticated, restores a safe selector if it belongs to the returned list, defaults to the first workspace, and exposes `refresh`, `selectWorkspace`, and `logout`.
- [ ] **Step 4: Ensure** provider state never stores credentials or raw server errors.
- [ ] **Step 5: Run** the provider test file; expect PASS.

### Task 4: Add auth forms and public auth routes

**Files:**
- Create: `components/saas/AuthForm.js`
- Create: `app/(auth)/login/page.js`
- Create: `app/(auth)/register/page.js`

- [ ] **Step 1: Implement** a shared client form with email/password fields, required-field validation, loading state, safe error message, and POST selection for login/register.
- [ ] **Step 2: On success** navigate to `/app/dashboard`; rely on the HttpOnly cookie and provider refresh rather than reading tokens.
- [ ] **Step 3: Add** links between login and register and an explicit link back to legacy `/studio`.
- [ ] **Step 4: Verify** no form, URL, or browser storage references `MUAPI_API_KEY`, `muapi_key`, or `x-api-key`.
- [ ] **Step 5: Run** `npm run build`; expect PASS.

### Task 5: Add protected SaaS route layout and responsive shell

**Files:**
- Create: `components/saas/ProtectedRoute.js`
- Create: `components/saas/WorkspaceSwitcher.js`
- Create: `components/saas/SaaSAppShell.js`
- Create: `app/(saas)/layout.js`

- [ ] **Step 1: Implement** `ProtectedRoute` with loading/unauthorized/error states and client navigation to `/login` when unauthenticated.
- [ ] **Step 2: Implement** workspace switcher with accessible select/menu semantics, selected workspace display, and selection callback.
- [ ] **Step 3: Implement** desktop collapsible sidebar and mobile drawer using local state and a native button; include Dashboard, Projects, Assets, Generations, Settings, and Legacy Studio links with unavailable routes visibly marked.
- [ ] **Step 4: Add** header workspace selector and logout action.
- [ ] **Step 5: Wrap** the protected route group in `SaaSProvider` and render the shell only after route protection.
- [ ] **Step 6: Run** `npm run build`; expect PASS.

### Task 6: Add dashboard and explicit empty/error states

**Files:**
- Create: `app/(saas)/dashboard/page.js`
- Optionally modify: `app/page.js` only if needed to add a separate SaaS entry without changing existing `/studio` redirect behavior.

- [ ] **Step 1: Implement** dashboard with welcome card, current workspace summary, feature cards, and links to available/coming-soon capabilities.
- [ ] **Step 2: Show** an onboarding empty state when no workspace is available; do not create fake workspace data client-side.
- [ ] **Step 3: Show** a safe error state with retry through provider `refresh`.
- [ ] **Step 4: Keep** `/studio` reachable and visibly separate.
- [ ] **Step 5: Run** `npm run build`; expect PASS.

### Task 7: Add frontend security and regression coverage

**Files:**
- Create: `tests/frontend/security.test.mjs`
- Create or modify: `tests/frontend/routes.test.mjs`

- [ ] **Step 1: Add** source scan assertions over hosted SaaS files that reject `MUAPI_API_KEY`, `localStorage` API-key patterns, `x-api-key`, and direct MuAPI execution imports.
- [ ] **Step 2: Add** route/source assertions that auth uses existing API paths, SaaS uses `/app`, and legacy `/studio` remains present.
- [ ] **Step 3: Run** `node --test tests/frontend/*.test.mjs`; expect PASS.
- [ ] **Step 4: Run** the full Node regression command used by the repository and record the actual result.

### Task 8: Final verification and documentation update

**Files:**
- Modify: `docs/sprint-1-progress.md` or the current frontend progress section only if the repository tracker has a suitable section.
- Review: all files above.

- [ ] **Step 1: Run** `npm run build`.
- [ ] **Step 2: Run** `node --test tests/**/*.test.mjs` using the repository-supported test invocation, correcting shell glob behavior if necessary.
- [ ] **Step 3: Run** `npm run config:check`.
- [ ] **Step 4: Run** `git diff --check`.
- [ ] **Step 5: Run** `rtk git diff` and inspect that no secrets or unrelated legacy changes were introduced.
- [ ] **Step 6: Update** the frontend progress note with changed files, tests, verification, and blockers; do not mark unrelated Notion tasks done.

## Self-review checklist

- Spec coverage: auth, session, workspace, shell, dashboard, UI primitives, states, security, tests, and legacy preservation are covered by Tasks 1–8.
- Placeholder scan: no implementation step relies on TBD/TODO or unspecified behavior.
- Interface consistency: `saasFetch`, provider context fields, and route paths are defined before consumers.
- Scope: package capability adapters remain follow-up work and are not mixed into this independently testable vertical slice.
