# ViMax Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ViMax Studio as a separate feature inside Open-Generative-AI, preserving the ViMax Web interaction model while keeping Open-Generative-AI as the host app.

**Architecture:** Next.js owns routing, auth, workspace context, and API boundaries. ViMax remains the execution engine. The first vertical slice adds the navigation route and a React shell; subsequent slices adapt session/chat/upload/events/artifacts and finally connect the server-side ViMax process.

**Tech Stack:** Next.js 15, React 19, JavaScript, existing Tailwind/CSS, Node child-process bridge, SSE, existing Vitest/browser test conventions.

## Global Constraints

- ViMax is a feature/engine inside Open-Generative-AI, not a second end-user application.
- ViMax Studio is a separate menu item and route: `/studio/vimax`.
- Reuse/adapt ViMax Web UX; do not use an iframe.
- Hosted SaaS credentials remain server-side; no BYOK secret is exposed to the browser.
- Existing studio tabs must remain unchanged.

## Task 1: Navigation and route vertical slice

Files:
- Modify `components/StandaloneShell.js`
- Modify `app/studio/[[...slug]]/page.js` only if route handling requires it
- Create `components/vimax/ViMaxStudioShell.js`
- Test `tests/frontend/vimax-studio-navigation.test.js`

Implement a `vimax` tab, add it to an appropriate navigation category, recognize it from the catch-all slug, and render a full-height shell at `/studio/vimax`. The first shell should clearly show the ViMax Studio title and stable regions for sessions, chat, and artifacts without connecting the engine yet.

TDD: write a test for the tab/route contract first, run it failing, implement the smallest change, run the focused test, then run the existing frontend suite.

## Task 2: Adapt ViMax Web presentation modules

Files:
- Create `components/vimax/ViMaxSidebar.js`
- Create `components/vimax/ViMaxChat.js`
- Create `components/vimax/ViMaxArtifacts.js`
- Create `components/vimax/vimax.css` or use existing host styles
- Test component states

Adapt layout and states from `ViMax/web/src/App.tsx`, `ArtifactViews.tsx`, and `styles.css`. Keep session sidebar, prompt composer, upload affordance, event timeline, artifact panel, storyboard panel, and settings entry as focused components.

## Task 3: Server API contract

Files:
- Create `app/api/vimax/health/route.js`
- Create `app/api/vimax/sessions/route.js`
- Create `app/api/vimax/messages/route.js`
- Create `app/api/vimax/events/route.js`
- Create `app/api/vimax/artifacts/route.js`
- Create `app/api/vimax/uploads/route.js`
- Create `src/services/vimax/*`
- Tests under `tests/vimax/`

Add authenticated, workspace-scoped endpoints. Keep process management in service modules, not React. Start with deterministic in-memory/test adapters if the existing database schema needs a separate migration.

## Task 4: ViMax process bridge and event normalization

Files:
- Create `src/services/vimax/agentBridge.js`
- Create `src/services/vimax/eventProtocol.js`
- Create `src/services/vimax/processRegistry.js`
- Tests under `tests/vimax/`

Spawn `main_agent.py --jsonl --stdin-repl` server-side, normalize JSONL events, support stop/exit/error, and expose SSE with reconnect-safe event IDs.

## Task 5: Sessions, uploads, artifacts, and persistence

Files:
- Add focused repository/service modules and migrations only if required
- Adapt existing asset/output storage boundaries
- Tests under `tests/vimax/`

Implement workspace-scoped session CRUD, safe uploads, artifact path containment, persistence, recovery, and output authorization.

## Task 6: Verification and rollout

Files:
- `docs/production-runbook.md` or focused ViMax integration docs
- test fixtures and browser test

Verify direct route refresh, navigation regression, session creation, prompt submission, upload, realtime events, artifact rendering, stop/recovery, and hosted secret policy. Add a feature flag and document local setup.
