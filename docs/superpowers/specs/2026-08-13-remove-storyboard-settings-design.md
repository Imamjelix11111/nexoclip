# Remove AI Storyboard Settings Design

## Goal
Remove the AI Storyboard's tenant-editable provider settings completely. ViMax configuration is server-side environment configuration only.

## Scope
- Remove the Settings navigation item and Settings screen from `services/vimax/web/src/App.tsx`.
- Reduce workspace views to `workspace` and `artifacts`.
- Remove settings API functions and configuration types from the React client.
- Remove `GET` and `PUT /api/config` routes from `services/vimax/web/server.mjs`.
- Delete `services/vimax/web/config-store.mjs` and its tests.
- Remove settings-only CSS from the active web stylesheet.
- Remove the obsolete preview-shell Settings entry in `components/vimax/ViMaxStudioShell.js`.

## Non-goals
- Do not change the environment-based ViMax/OpenRouter configuration in `services/vimax/agent_runtime/config.py`.
- Do not alter project, chat, artifacts, upload, or generation endpoints.
- Do not remove unrelated visual styling.

## Validation
- Web build/type-check succeeds.
- Existing web tests pass after config-store tests are removed.
- Repository search finds no active Storyboard settings view, `/api/config` route, or config-store import.
