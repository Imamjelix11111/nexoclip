# Restore AI Storyboard UI Design

## Goal
Restore the familiar AI Storyboard workspace while retaining durable, refresh-safe render jobs.

## Problem
`ViMaxApp.tsx` was reduced to a render-only screen during the durable-job migration. It removed the sidebar, session list, chat/history, composer, upload/artifact surfaces, and the normal storyboard workflow. The reduced screen avoids legacy agent restarts, but it is not an acceptable replacement for the existing product UI.

## Constraints
- Keep render execution durable: browser -> authenticated Next API -> PostgreSQL/BullMQ -> worker -> private FastAPI runtime.
- Refreshing or opening a session must never invoke legacy `startAgent`, `stopAgent`, or otherwise interrupt an active durable render.
- Keep server-derived workspace/tenant authorization; do not expose runtime credentials or filesystem paths to the browser.
- Preserve the compact translucent/glass composer treatment and a noticeably taller textarea.
- Do not overwrite unrelated dirty changes.
- Legacy read surfaces may be used only when backed by a working server route. Legacy write/render bridge calls must not be reintroduced.

## Options considered

### 1. Restore the old UI and replace only render dispatch (recommended)
Reintroduce the previous workspace shell, but separate view state from execution state. The restored render control submits/polls durable generation jobs. Legacy rendering calls are removed.

**Pros:** Restores the familiar product quickly; minimizes visual churn; keeps durable guarantees.

**Cons:** Requires a supported source for sessions/history/artifacts, rather than assuming the former proxy works.

### 2. Build a new durable-only workspace
Redesign a modern replacement around durable jobs, sessions, and artifacts.

**Pros:** No legacy UI dependency.

**Cons:** Larger UX redesign and not what the user requested.

### 3. Keep the render-only page
No implementation work.

**Pros:** Smallest code path.

**Cons:** Current broken user experience.

## Approved design

### UI composition
Restore the prior shell layout:
- Sidebar with project/session navigation.
- Main conversation/history pane.
- Artifact/output panel where it was available before.
- Composer at the bottom, with the existing glass surface, compact outer height, and a taller editable textarea.

The restored shell is a client-side view layer. Loading a session displays durable/session data but does not create, restart, or terminate a renderer.

### Session and read state
Replace any browser call to the old catch-all ViMax bridge with explicit authenticated Next API routes. Each route derives the workspace from the authenticated user. The routes provide only data that has a real backing implementation. If an old capability is not yet migrated (for example, uploads), the UI shows an explicit unavailable state rather than sending a request to a blocked bridge endpoint.

New project creation uses the authenticated durable-session creation route. Its returned session identifier becomes selected in the restored sidebar.

### Durable render interaction
The restored render action submits the existing structured `vimax_render_video` job. It persists the job identifier by session in browser storage and reads authoritative status/progress/result from the authenticated generation-status API on load and reconnect.

The UI renders queued/running/succeeded/failed state in the familiar workspace. It never infers a render job from arbitrary free-form chat text. Interactive chat remains view-only/explicitly unavailable until its own persistence migration is complete, rather than silently starting the legacy bridge.

### Error handling
- Session/read API failure: retain current visible UI, show inline retryable error.
- Durable submission failure: leave the selected session intact and show an inline error; do not fall back to a legacy renderer.
- Job polling failure: retain last known job state, show reconnecting/error state, and retry on the defined interval.
- Unsupported legacy capability: explain that the capability is temporarily unavailable during migration.

### Tests
- A component test verifies restored shell state can select/create a session without calling legacy `startAgent`/`stopAgent`.
- A component/API test verifies render dispatch uses the durable job client and restores/polls saved job state after reload.
- Route tests verify workspace comes from authentication and no browser-supplied filesystem/tenant identity is trusted.
- Build and focused UI/API test suites verify the TypeScript component compiles and the existing glass/textarea presentation remains intact.

## Non-goals
- Migrating free-form chat turn persistence.
- Re-enabling the legacy Node/Python bridge for browser writes.
- Object storage migration beyond exposing already durable job result/artifact metadata.
- Redesigning AI Storyboard visual identity.
