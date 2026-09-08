# Spite Realtime CRDT Reconnaissance

## 1. Current architecture map

- **Repo/runtime split**
  - `nexoclip-app/` is the main Next.js app. `package-lock.json` shows npm lockfile v3; `next.config.mjs` uses `output: 'standalone'`.
  - `nexoclip-app/services/spite/` is a separate Next.js app mounted under `/spite`. `pnpm-lock.yaml` shows pnpm lockfile v9; `next.config.mjs` uses `output: 'standalone'`, `basePath` from `NEXT_PUBLIC_BASE_PATH`, and `images.unoptimized = true`.
- **Current versions and package managers**
  - Main app package manager: **npm** (`package-lock.json`). Key deps resolved include `next@15.5.15`, `react@19.x`, `react-dom@19.x`, `pg`, `bullmq`, `ioredis`.
  - Spite package manager: **pnpm** (`pnpm-lock.yaml`, `pnpm-workspace.yaml`). Key deps resolved include `next@16.2.11`, `react@19.2.4`, `react-dom@19.2.4`, `@xyflow/react@12.10.2`, `@neondatabase/serverless@1.1.0`, `tsx@4.20.6`, `typescript@5.7.3`.
  - **Absent today** in both package manifests/locks: `yjs`, `@hocuspocus/server`, `@hocuspocus/provider`, `y-protocols`, `jose`.
- **Node/runtime boundaries**
  - Main app Dockerfile uses `node:20-bookworm-slim` for deps, builder, web, worker, and migrate targets.
  - Spite Dockerfile also uses `node:20-bookworm-slim` for deps, builder, and runner.
  - No repo-level `.nvmrc`/`engines` pin was found in the inspected entrypoints. The approved plan’s Node 22 target is not yet reflected in Docker.
- **Main Next.js entrypoints**
  - Main app session endpoint: `nexoclip-app/app/api/auth/session/route.js` reads `nexoclip_session` and returns `{ authenticated, user, expiresAt }` via `getCurrentSession`.
  - Spite root entrypoints:
    - `services/spite/app/layout.tsx` wraps the app with `AuthProvider`.
    - `services/spite/app/page.tsx` renders `ProjectsDashboard`.
    - `services/spite/app/project/[id]/page.tsx` renders `CanvasWorkspace`.
    - `services/spite/app/m/project/[id]/page.tsx` is the separate flow/mobile thread UI.
- **Canvas ownership today**
  - `services/spite/components/canvas/canvas-workspace.tsx` owns canvas state with `useNodesState`, `useEdgesState`, local `scenes`, local `activeSceneId`, local history stacks, and local asset state.
  - React Flow is not derived from a collaborative document today; it is the primary in-browser durable state before autosave.
- **Build targets**
  - Main app Docker targets: `web`, `worker`, `migrate`.
  - Spite Docker targets: `builder`, `runner` only; there is no dedicated realtime or migration target.
- **Existing test commands**
  - Main app has no top-level `test` script in the inspected manifest; existing tests are run directly with `node --test ...` (see deployment/production test files and the implementation plan’s current command style).
  - Spite scripts are `dev`, `build`, `start`, `lint`, `test`, `release`.
  - Spite test command is `tsx --test "lib/**/*.test.ts"`; there is no existing `realtime/` test suite.

## 2. Existing mutation paths

- **Initial hydration path**
  - `CanvasWorkspace` loads project metadata from `GET /api/projects/[projectId]`, then canvas state from `GET /api/projects/[projectId]/canvas`, then assets from `GET /api/projects/[projectId]/assets`.
  - Viewport is restored separately from `localStorage` by `ViewportPersistor` before async canvas fetch completes.
- **React Flow ownership today**
  - `canvas-workspace.tsx` holds durable-ish state in local React state:
    - `nodes`, `edges` via `useNodesState`/`useEdgesState`
    - `scenes`, `activeSceneId`
    - undo/redo stacks in `past`/`future`
  - `ReactFlow` receives `onNodesChange` and `onEdgesChange` directly from those hooks.
- **Workspace-level mutation entrypoints**
  - `onConnect` adds edges via `addEdge(...)` into local edge state.
  - `addNode` appends new nodes directly.
  - `handleAddScene` and `handleDeleteScene` mutate local scene state; scene delete also directly removes related nodes and edges.
  - `undo`/`redo` restore whole node/edge arrays from local history snapshots.
  - `deleteSelected` removes selected nodes and related edges directly, then separately PATCHes/POSTs asset protection routes.
  - `duplicateSelected` clones selected nodes directly in local state.
  - Clipboard cut/copy/paste mutates local nodes/edges directly.
  - Pane clicks create sticker/comment nodes directly.
  - Edge clicks with the cut tool remove edges directly.
  - Project rename triggers `PUT /api/projects/[projectId]` after a 500 ms debounce.
- **Child-component direct setters that bypass a shared mutation boundary**
  - `nodes/prompt-node.tsx` writes prompt text and mentions directly into node data with `setNodes`.
  - `nodes/reference-node.tsx` writes shot assignment and width directly with `setNodes`.
  - `nodes/comment-node.tsx` writes comment text directly and deletes via `deleteElements`.
  - `nodes/sticker-node.tsx` keeps the chosen sticker in component state and deletes via `deleteElements`; it does not persist the chosen sticker back into node data in the inspected file.
  - `nodes/compress-node.tsx` writes `outputUrl`, `thumbnail`, compression settings, and byte counts directly into node data.
  - `nodes/image-node.tsx` and `nodes/video-node.tsx` both directly mutate node data for width, prompt/model settings, shot assignment, pending generation fields, labels, thumbnails, output URLs, and batch-duplicate nodes.
  - `nodes/node-toolbar.tsx` directly deletes nodes, duplicates nodes, repositions nodes, quick-connects by calling `addNodes`/`addEdges`, and rearranges selections via `setNodes`.
  - `connected-inputs.tsx` disconnects edges directly with `setEdges`.
  - `edges/scissors-edge.tsx` disconnects a clicked edge directly with `setEdges`.
- **Generation callbacks mutating canvas state**
  - `image-node.tsx` and `video-node.tsx` submit jobs to `/api/generate/submit`, persist pending request info into node data, poll `/api/generate/status`, and on completion set `outputUrl`/status fields directly into node data.
  - Batch image/video runs create duplicate nodes in the browser and mirror incoming edges with a `frame-add-edges` event.
  - `image-node.tsx` has a mount-time recovery call to `GET /api/generate/latest?...` and writes the recovered result back into node data.
- **Restore/duplication/destructive checks**
  - Snapshot restore currently rewrites `canvas_nodes` and `canvas_edges` directly from a selected snapshot.
  - Project duplication copies the project row plus `canvas_nodes`/`canvas_edges` directly.
  - Destructive asset deletion checks current references by scanning `canvas_nodes.data` for matching `assetId`, `outputUrl`, or `thumbnail` values.

## 3. Existing persistence paths

- **Current authoritative persistence is relational, not CRDT-based**
  - `services/spite/app/api/projects/[projectId]/canvas/route.ts` is the main persistence boundary.
  - POST takes full `{ nodes, edges, scenes, activeSceneId }` payloads and persists by:
    1. taking `pg_advisory_xact_lock(CANVAS_SAVE_LOCK_NS, hashtext(projectId))`
    2. deleting all project rows from `canvas_nodes` and `canvas_edges`
    3. reinserting every node and edge
    4. updating `projects.updatedat`, `projects.scenes`, and `projects.active_scene_id`
  - GET reconstructs browser state from `canvas_nodes`, `canvas_edges`, and `projects.scenes`/`active_scene_id`.
- **Autosave path**
  - `hooks/use-canvas-auto-save.ts` is the active durable save mechanism.
  - It posts the full canvas after a 3 s debounce, runs a 30 s backup interval, and uses `navigator.sendBeacon` on unmount.
  - It keeps only a coarse `saved/unsaved/saving` client status and does not wait for any durable server acknowledgment beyond HTTP success.
- **Snapshot persistence**
  - `canvas/route.ts` also lazily creates and writes `canvas_snapshots` as rolling backups, throttled to one per 5 minutes and trimmed to the newest 30 snapshots.
  - `canvas/snapshots/route.ts` lists those snapshots and restores by bulk delete/reinsert of `canvas_nodes`/`canvas_edges`.
  - Snapshot restore does **not** restore `projects.scenes` or `projects.active_scene_id` in the inspected route.
- **Generation persistence paths**
  - `app/api/generate/submit/route.ts` records completed image outputs in `generation_history` through `recordAsset(...)`, then directly updates `canvas_nodes.data` via `attachGeneratedMediaToNode(...)`.
  - `app/api/generate/status/route.ts` does the same for completed video outputs after polling.
  - `app/api/generate/recover/route.ts` scans `canvas_nodes.data` for `pendingRequestId`/`pendingFalEndpoint`, records recovered assets in `generation_history`, then directly clears pending markers with `UPDATE canvas_nodes SET data = data - ...`.
  - `lib/r2-upload.ts` is the shared direct DB mutation helper for `recordAsset`, `attachGeneratedMediaToNode`, and `markAssetUsedInCanvas`.
- **Project lifecycle persistence**
  - `app/api/projects/route.ts` inserts projects directly.
  - `app/api/projects/[projectId]/route.ts` updates/deletes projects directly and manually tears down `canvas_nodes`, `canvas_edges`, `assets`, and folder tables.
  - `app/api/projects/[projectId]/duplicate/route.ts` copies project rows plus `canvas_nodes`/`canvas_edges` directly.
  - The inspected duplicate route does **not** copy `projects.scenes` or `projects.active_scene_id`.
- **Asset/folder persistence**
  - `generation_history` acts as the main generated-media library and upload registry.
  - `assets` stores separate project file upload metadata.
  - `asset_folders` and `asset_folder_items` store manual grouping.
  - Canvas save reconciliation, asset routes, and folder routes toggle `generation_history.used_in_canvas` and `expires_at` directly.

## 4. Existing auth/session paths

- **Main app auth/session path**
  - `nexoclip-app/src/lib/auth/session.js` defines the `nexoclip_session` cookie.
  - `src/services/authService.js` creates hashed session records and resolves `getCurrentSession(token)`.
  - `app/api/auth/session/route.js` returns the authenticated main-app user for a valid `nexoclip_session`.
  - `src/services/tenantContext.js` uses that session plus workspace membership to authorize main-app API access.
- **Spite auth/session path**
  - Spite uses a completely separate cookie, `spite_session`, backed by `services/spite/lib/sessions.ts` in the Spite database.
  - Login is password-only via `APP_PASSWORD`; there is no per-user identity in the Spite session model.
  - `services/spite/middleware.ts` performs two gates:
    1. required-env gate via `checkRequiredEnv()`
    2. session validation via `isSessionValid(spite_session)`
  - Public paths are limited to `/login`, `/setup`, auth endpoints, cleanup cron, and the R2 proxy.
  - `components/auth-provider.tsx` only asks `/api/auth/check` whether the local Spite cookie is valid.
- **Ownership/authorization gaps**
  - `app/api/projects/route.ts` creates projects under hard-coded `DEFAULT_USER_ID = 00000000-0000-0000-0000-000000000001`.
  - `app/api/projects/[projectId]/duplicate/route.ts` also inserts duplicates under the same hard-coded `DEFAULT_USER_ID`.
  - Inspected project, canvas, asset, folder, generation, duplicate, and snapshot routes accept `projectId` and operate directly against rows without any trusted user lookup or owner predicate.
  - There is no call today from Spite into the main app’s `/api/auth/session` endpoint.
  - There is no room token, no JWT verification, no HMAC internal auth endpoint, and no websocket authorization flow.

## 5. Existing deployment paths

- **Current production service topology** (`nexoclip-app/docker-compose.prod.yml`)
  - `caddy` is the only public ingress.
  - App services are `nexoclip`, `spite`, `scheduler`, `ai-clip`, `vimax`, plus `storyboard-worker` and migration jobs.
  - Database env separation already exists at the compose level:
    - main app gets `DATABASE_URL_NEXOCLIP` as `DATABASE_URL`
    - Spite gets `DATABASE_URL_SPITE`
    - scheduler gets its own DB URLs
- **Current HTTP routing** (`nexoclip-app/Caddyfile`)
  - `/ai-clip-api/* -> ai-clip:4175`
  - `/spite* -> spite:3005`
  - `/scheduler* -> scheduler:3006`
  - default -> `nexoclip:3000`
  - There is no dedicated `/spite/ws` route and no explicit deny for `/spite/api/internal/*`.
- **Current Docker targets**
  - Main app Dockerfile has `web`, `worker`, `migrate`; no realtime target.
  - Spite Dockerfile builds one Next standalone HTTP app; no Hocuspocus/realtime process target.
- **Current local development topology** (`docker-compose.yml`)
  - Local compose exposes Postgres, Spite (`3005:3005`), and main app (`3000:3000`) directly; there is no local Caddy ingress.
- **Current deployment/test contracts**
  - `tests/deployment/dockerDeployment.test.mjs` asserts the present AMD64/docker/caddy setup and database separation, but not websocket/realtime services.
  - `tests/production/productionConfig.test.mjs` validates only current main-app production secrets (`DATABASE_URL`, `MUAPI_API_KEY`, `MUAPI_BASE_URL`, `LOCAL_OBJECT_STORAGE_SECRET`).
  - `tests/production/dockerComposeIngress.test.mjs` checks current local compose ingress assumptions only.

## 6. Conflicts with this implementation plan

- **Authoritative state conflict**
  - Current authoritative canvas state is `canvas_nodes` + `canvas_edges` + `projects.scenes`/`active_scene_id`, rewritten as full arrays by autosave and restore. The approved plan requires persisted Yjs state in Neon to become the only authoritative collaborative state.
- **Mutation-boundary conflict**
  - Canvas mutations are currently spread across `canvas-workspace.tsx`, multiple node components, `node-toolbar.tsx`, `connected-inputs.tsx`, and `scissors-edge.tsx`, all calling React Flow setters directly. The approved plan requires mutations to funnel through Yjs commands and derived React Flow state.
- **Server-writer conflict**
  - Current trusted server routes directly mutate projection tables and `canvas_nodes.data` (`attachGeneratedMediaToNode`, recovery cleanup, restore, duplicate). The approved plan requires all trusted mutations to enter a shared runtime, apply a Y.Doc transaction, and follow one durable update pipeline.
- **Session/ownership conflict**
  - Spite currently authenticates with its own `spite_session` password gate and has no per-user identity. Project creation/duplication still uses a placeholder `DEFAULT_USER_ID`, and inspected routes do not constrain by owner. The approved plan requires main-session validation, trusted user lookup, ownership checks before room access/hydration, and repeated authorization in the realtime service.
- **Schema conflict**
  - `database-setup.sql` contains no `canvas_yjs_documents`, `canvas_yjs_updates`, or `canvas_auth_nonces` tables. There is no durable sequence model, no snapshot/update compaction state, and no nonce replay store.
- **Deployment/runtime conflict**
  - Both main and Spite Dockerfiles are still Node 20. There is no realtime process, no `/spite/ws` routing, no health/internal auth endpoint, no migration runner for realtime schema, and no deployment contracts for realtime env vars.
- **Snapshot/duplicate behavior conflict**
  - Current snapshot restore and project duplication operate on relational projections directly; duplicate also omits `scenes`/`active_scene_id`, and snapshot restore does not restore them. The approved plan expects duplication/restore to become Yjs-aware and projection-only side effects.
- **Test-surface conflict**
  - There is no existing `tests/realtime/` suite in the main app and no `services/spite/realtime/*.test.ts` or `lib/realtime/*.test.ts` surface yet, so Tasks 1+ start from missing test scaffolding rather than modifying existing realtime coverage.

## 7. Files that differ from the proposed file map

- **Proposed create-paths that do not exist yet (verified missing in the repo today)**
  - `nexoclip-app/src/lib/realtime/internalAuth.js`
  - `nexoclip-app/src/lib/realtime/token.js`
  - `nexoclip-app/app/api/auth/realtime-token/route.js`
  - `nexoclip-app/tests/realtime/` (no inspected realtime tests exist yet)
  - `nexoclip-app/services/spite/lib/realtime/` (directory absent)
  - `nexoclip-app/services/spite/lib/realtime/document.ts`
  - `nexoclip-app/services/spite/lib/realtime/react-flow-binding.ts`
  - `nexoclip-app/services/spite/lib/realtime/presence.ts`
  - `nexoclip-app/services/spite/hooks/use-realtime-canvas.ts`
  - `nexoclip-app/services/spite/components/canvas/realtime-presence.tsx`
  - `nexoclip-app/services/spite/realtime/` (directory absent)
  - `nexoclip-app/services/spite/realtime/db.ts`
  - `nexoclip-app/services/spite/realtime/yjs-repository.ts`
  - `nexoclip-app/services/spite/realtime/projector.ts`
  - `nexoclip-app/services/spite/realtime/project-runtime.ts`
  - `nexoclip-app/services/spite/realtime/auth.ts`
  - `nexoclip-app/services/spite/realtime/internal-auth.ts`
  - `nexoclip-app/services/spite/realtime/server.ts`
  - `nexoclip-app/services/spite/lib/main-session.ts`
- **Proposed modify-paths that already exist at the expected locations**
  - `nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx`
  - `nexoclip-app/services/spite/components/canvas/canvas-toolbar.tsx`
  - `nexoclip-app/services/spite/hooks/use-canvas-auto-save.ts`
  - `nexoclip-app/services/spite/components/canvas/nodes/image-node.tsx`
  - `nexoclip-app/services/spite/components/canvas/nodes/video-node.tsx`
  - `nexoclip-app/services/spite/components/canvas/nodes/reference-node.tsx`
  - `nexoclip-app/services/spite/components/canvas/nodes/prompt-node.tsx`
  - `nexoclip-app/services/spite/components/canvas/nodes/comment-node.tsx`
  - `nexoclip-app/services/spite/components/canvas/nodes/sticker-node.tsx`
  - `nexoclip-app/services/spite/components/canvas/nodes/compress-node.tsx`
  - `nexoclip-app/services/spite/components/canvas/nodes/node-toolbar.tsx`
  - `nexoclip-app/services/spite/components/canvas/connected-inputs.tsx`
  - `nexoclip-app/services/spite/components/canvas/edges/scissors-edge.tsx`
  - `nexoclip-app/services/spite/app/api/projects/[projectId]/canvas/route.ts`
  - `nexoclip-app/services/spite/app/api/projects/[projectId]/canvas/snapshots/route.ts`
  - `nexoclip-app/services/spite/app/api/projects/[projectId]/duplicate/route.ts`
  - `nexoclip-app/services/spite/app/api/generate/submit/route.ts`
  - `nexoclip-app/services/spite/app/api/generate/status/route.ts`
  - `nexoclip-app/services/spite/app/api/generate/recover/route.ts`
  - `nexoclip-app/services/spite/database-setup.sql`
  - `nexoclip-app/services/spite/Dockerfile`
  - `nexoclip-app/docker-compose.prod.yml`
  - `docker-compose.yml`
- **Assumption deltas worth carrying into Task 1+**
  - Current runtime is Node 20 in Docker, not Node 22.
  - Current Spite auth is a standalone password/session system, not main-session introspection.
  - Current projection tables are still authoritative and directly mutated by both browser and server paths.
