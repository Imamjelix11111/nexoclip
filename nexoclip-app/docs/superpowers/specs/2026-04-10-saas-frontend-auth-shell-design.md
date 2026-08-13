# SaaS Frontend Auth and Application Shell Design

## Goal

Implement the first Sprint 4 hosted-SaaS vertical slice without rebuilding existing feature packages:

```text
/register or /login
  -> session restore
  -> workspace selection
  -> authenticated SaaS shell
  -> dashboard
```

The existing `/studio` route and legacy `StandaloneShell` remain unchanged and available for BYOK/Electron compatibility.

## Scope

### Included

- Login and registration pages.
- Session restore and logout.
- Protected SaaS route layout.
- Workspace listing and workspace selection.
- Empty workspace/onboarding state where the current API cannot create a workspace.
- Responsive SaaS shell with collapsible desktop sidebar and mobile drawer.
- Dashboard landing page with loading, empty, unauthorized, and error states.
- Minimal shadcn-style UI primitives implemented using the existing project styling approach.
- Frontend tests for auth, session, workspace selection, route behavior, and secret non-disclosure.

### Excluded

- Rebuilding `/studio` or existing package UIs.
- Workflow, agent, design-agent, video, audio, or media SaaS adapters.
- Payment checkout.
- Provider credentials in the browser.
- Treating a client-selected workspace as authorization.
- Broad visual redesign of legacy screens.

## Routes

```text
/login       public SaaS login
/register    public SaaS registration
/app         authenticated SaaS landing route
/app/dashboard authenticated dashboard
/app/projects   reserved for next slice
/app/settings   reserved for next slice
/studio      existing legacy route, preserved
```

The root route continues to preserve the current legacy behavior unless an existing product decision explicitly changes it. SaaS users enter through `/login` or `/register`, then `/app/dashboard`.

## Component structure

```text
app/
  (auth)/login/page.js
  (auth)/register/page.js
  (saas)/layout.js
  (saas)/dashboard/page.js

components/saas/
  SessionProvider.js
  ProtectedRoute.js
  SaaSAppShell.js
  SaaSSidebar.js
  SaaSMobileNav.js
  WorkspaceSwitcher.js
  LoadingState.js
  EmptyState.js
  ErrorState.js
  UnauthorizedState.js

components/ui/
  button.js
  input.js
  label.js
  card.js
  badge.js
  alert.js
  skeleton.js
  separator.js
```

Exact placement may follow existing repository conventions, but responsibilities must remain separated: auth/session, tenant context, shell/navigation, and state primitives must not be combined into one monolithic component.

## Auth and session flow

1. Login/register forms validate required fields client-side.
2. Forms call the existing same-origin auth routes with `credentials: include`.
3. The server sets the existing HttpOnly session cookie.
4. The client calls `GET /api/auth/session` to hydrate the session.
5. The client calls `GET /api/workspaces` after an authenticated session exists.
6. If workspaces exist, select the current workspace and navigate to `/app/dashboard`.
7. If no workspace exists, show an explicit onboarding/empty state rather than inventing a client-side workspace.
8. Logout calls `POST /api/auth/logout`, clears client state, and navigates to `/login`.
9. A `401` from a protected request clears session state and redirects to `/login`.

The browser may persist only a non-secret workspace selector if needed. Server-side membership remains the authorization source for every SaaS request.

## SaaS shell behavior

- Desktop: fixed/collapsible left sidebar and top header.
- Mobile: sidebar becomes a drawer controlled by a menu button.
- Header displays the selected workspace and logout action.
- Navigation includes Dashboard, Projects, Assets, Generations, and Settings as links or disabled/coming-soon states according to implemented routes.
- Legacy Studio is visibly separated and links to `/studio`.
- Navigation does not imply that an unimplemented feature is available.

## UI approach

Use minimal shadcn-style primitives rather than introducing a large component framework. Components should use the existing Tailwind/configuration if available, a local `cn` helper if needed, and accessible native controls underneath. Avoid adding unrelated dependencies.

All forms and shell states must support keyboard focus, visible validation, disabled/loading states, and readable error messages.

## Error and state handling

Every page must have explicit states:

- Loading: session/workspace fetch or form submission in progress.
- Empty: authenticated user has no workspace or no dashboard data.
- Unauthorized: session absent or request returns `401`.
- Error: safe generic message with retry where possible.
- Offline/network: request failure without exposing raw server/provider payloads.

No provider error, raw usage, prompt payload, or secret is rendered in the browser.

## Testing strategy

Use the repository's existing JavaScript ES module test approach and mock `fetch`/router boundaries where practical.

Required coverage:

- Login submits credentials and handles success/failure.
- Registration submits credentials and handles success/failure.
- Session provider restores an existing session.
- Unauthenticated protected layout redirects to login.
- Workspace list is loaded only after authentication.
- Workspace switching updates SaaS context and does not claim authorization.
- Logout clears state and navigates to login.
- `401` response triggers session reset.
- Hosted frontend source contains no `MUAPI_API_KEY`, provider secret handling, or BYOK storage path.
- Existing legacy `/studio` route remains buildable.

## Acceptance criteria

- A new user can submit registration through the UI and reach the authenticated flow when the backend creates/returns workspace access.
- An existing user can log in, restore a session after refresh, select an available workspace, and reach `/app/dashboard`.
- Logout works and protected routes redirect correctly.
- The SaaS shell is responsive with collapsible sidebar/mobile drawer behavior.
- Missing workspace/dashboard data produces explicit empty states.
- Existing `/studio` and compatibility behavior are not removed or broadly changed.
- No provider API key is read, stored, or sent by the SaaS frontend.
- Relevant tests, build, and diff checks pass.

## Follow-up

After this slice is verified, implement project/dashboard data, asset library, shared generation composer/status UI, then package capability adapters in the Sprint 4 order recorded in Notion.
