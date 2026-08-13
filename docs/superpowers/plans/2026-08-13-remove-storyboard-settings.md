# Remove AI Storyboard Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all tenant-editable AI Storyboard provider settings so ViMax is configured only through server-side environment variables.

**Architecture:** The React application will expose only workspace and artifacts views and make no configuration requests. The Node web service will no longer expose `/api/config` or import the tenant config store. The obsolete config persistence module, its tests, settings-specific styling, and preview-shell Settings entry will be deleted.

**Tech Stack:** React 19, TypeScript, Vite, Node.js HTTP server, Vitest.

## Global Constraints

- Keep `OPENROUTER_API_KEY` and `VIMAX_*` server-side environment configuration unchanged.
- Do not alter sessions, agent lifecycle, artifacts, uploads, chat, or generation APIs.
- Do not add dependencies.
- Tests must not call remote APIs.

---

### Task 1: Remove client Settings feature

**Files:**
- Modify: `nexoclip-app/services/vimax/web/src/App.tsx`
- Modify: `nexoclip-app/services/vimax/web/src/api.ts`
- Modify: `nexoclip-app/services/vimax/web/src/types.ts`
- Modify: `nexoclip-app/services/vimax/web/src/styles.css`
- Modify: `nexoclip-app/components/vimax/ViMaxStudioShell.js`

**Interfaces:**
- Consumes: existing `workspace` and `artifacts` navigation/render paths.
- Produces: a UI with no Settings navigation action, view, types, API calls, or Settings-only CSS.

- [ ] **Step 1: Remove client config API/type exports**

Delete the config-only exports:

```ts
// api.ts
getAgentConfig()
saveAgentConfig(config: AgentConfig)

// types.ts
ConfigSection
AgentConfig
```

Also remove the corresponding `AgentConfig` import from `api.ts`.

- [ ] **Step 2: Remove Settings state, navigation, and render code**

In `App.tsx`:

```ts
// Before
type WorkspaceView = 'workspace' | 'artifacts' | 'settings';

// After
type WorkspaceView = 'workspace' | 'artifacts';
```

Remove `Settings` from the Lucide imports; remove `getAgentConfig`, `saveAgentConfig`, `AgentConfig`, and `ConfigSection` imports; remove `onSettings` from `Sidebar` props and call sites; remove its button. Simplify the non-workspace header to always render `Artifacts`. Remove `SettingsView`, `CONFIG_SECTIONS`, and `ConfigSectionEditor` entirely. Render `<ArtifactsView ... />` for the only remaining non-workspace case.

- [ ] **Step 3: Delete settings-only CSS**

Delete all rules whose selectors are exclusively `.settings-*`, `.config-fields`, including responsive/dark-theme variants. Keep unrelated CSS untouched.

- [ ] **Step 4: Remove preview shell entry**

In `components/vimax/ViMaxStudioShell.js`, remove the `settings` entry from `panels` and simplify the empty-state conditional to only show the artifacts message for the remaining non-workspace view.

- [ ] **Step 5: Verify client build**

Run:

```bash
cd nexoclip-app/services/vimax/web && npm run build
```

Expected: build exits 0 with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
rtk git add nexoclip-app/services/vimax/web/src/App.tsx nexoclip-app/services/vimax/web/src/api.ts nexoclip-app/services/vimax/web/src/types.ts nexoclip-app/services/vimax/web/src/styles.css nexoclip-app/components/vimax/ViMaxStudioShell.js
rtk git commit -m "refactor: remove storyboard settings UI"
```

### Task 2: Remove tenant config API and persistence

**Files:**
- Modify: `nexoclip-app/services/vimax/web/server.mjs`
- Delete: `nexoclip-app/services/vimax/web/config-store.mjs`
- Delete: `nexoclip-app/services/vimax/web/config-store.test.mjs`

**Interfaces:**
- Consumes: server request router and existing agent lifecycle operations.
- Produces: no `/api/config` route or config persistence capability; all remaining API routes retain their existing behavior.

- [ ] **Step 1: Remove config-store import and routes**

Delete:

```js
import {readAgentConfig, saveAgentConfig} from './config-store.mjs';
```

Delete both route blocks for `GET /api/config` and `PUT /api/config`, including their `stopAgent(tenantId, 'config')` behavior.

- [ ] **Step 2: Delete config persistence module and tests**

Remove `config-store.mjs` and `config-store.test.mjs`; no code should write tenant `configs/agent.local.yaml` through the web service after this task.

- [ ] **Step 3: Verify routes and tests**

Run:

```bash
cd nexoclip-app/services/vimax/web && npm test -- --run
rtk proxy rg -n '(/api/config|config-store|SettingsView|getAgentConfig|saveAgentConfig)' src server.mjs . --glob '*.{ts,tsx,js,mjs}'
```

Expected: tests exit 0 and search has no active source matches (the command itself may need scope narrowed to avoid node_modules).

- [ ] **Step 4: Commit**

```bash
rtk git add nexoclip-app/services/vimax/web/server.mjs nexoclip-app/services/vimax/web/config-store.mjs nexoclip-app/services/vimax/web/config-store.test.mjs
rtk git commit -m "refactor: remove storyboard config API"
```

### Task 3: Full verification

**Files:**
- Verify only.

- [ ] **Step 1: Run full web validation**

```bash
cd nexoclip-app/services/vimax/web && npm test -- --run && npm run build
```

Expected: both commands exit 0.

- [ ] **Step 2: Verify repository hygiene**

```bash
rtk git diff --check
rtk docker compose config --quiet
rtk git status --short
```

Expected: no whitespace errors, compose configuration exits 0, and status lists only intended changes.

- [ ] **Step 3: Commit verification-ready state if any changes remain unstaged**

```bash
rtk git add -A
rtk git commit -m "test: verify storyboard settings removal"
```
