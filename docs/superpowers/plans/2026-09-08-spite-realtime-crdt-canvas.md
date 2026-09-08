# Spite Realtime CRDT Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement realtime collaborative Spite canvases where persisted Yjs state in Neon is authoritative, Hocuspocus hosts active replicas, React Flow renders derived state, and legacy canvas tables are one-time import sources plus asynchronous projections.

**Architecture:** The main app validates `nexoclip_session`, obtains project authorization from the private canvas service, and issues a 60-second room-bound JWT. A dedicated Hocuspocus process authorizes before loading rooms, reconstructs Yjs documents from Neon snapshots plus ordered updates, batches durable update writes, compacts snapshots, projects state asynchronously, and carries ephemeral Awareness. The Spite client writes all canvas mutations to nested Yjs maps and derives React Flow state from observers.

**Tech Stack:** Next.js 15/16, React 19, React Flow 12, Yjs 13, Hocuspocus 4, jose 6, Neon PostgreSQL, Node 22, TypeScript, node:test/tsx, Docker Compose, Caddy.

## Global Constraints

- Persisted Yjs document state in Neon is the only authoritative collaborative canvas state.
- Hocuspocus `Y.Doc` instances are reconstructible active replicas; React Flow state is derived UI only.
- `canvas_nodes`, `canvas_edges`, and project scene fields are projection/compatibility data only.
- Legacy relational canvas data may initialize Yjs exactly once and must never hydrate an existing persisted Yjs document.
- Nodes and edges use nested `Y.Map` values; positions use separate `positionX` and `positionY` fields.
- Awareness is ephemeral; participant identity is per tab in `sessionStorage`; soft locks are UX hints, not correctness.
- Incremental updates are first-class durable data with monotonic per-project sequence numbers.
- Snapshot encoding and its persisted update boundary are serialized per project.
- JWT verification pins `HS256`, issuer `nexoclip`, audience `nexoclip-realtime`, expiry, and room-bound `projectId`.
- Ownership is checked before room join/hydration and repeated by Hocuspocus.
- Three participants is a target, never a hard limit.
- Neon failure uses a bounded queue and transitions document mutation to read-only while Awareness remains available.
- All feature and behavior changes follow red-green-refactor; no production implementation precedes its failing test.

---

## File Map

### Main app

- Create `nexoclip-app/src/lib/realtime/internalAuth.js`: canonical payload and HMAC signing.
- Create `nexoclip-app/src/lib/realtime/token.js`: fixed-policy realtime JWT issuer.
- Create `nexoclip-app/app/api/auth/realtime-token/route.js`: session validation, Canvas Auth call, token response.
- Create `nexoclip-app/tests/realtime/internalAuth.test.mjs` and `realtimeTokenRoute.test.mjs`.
- Modify `nexoclip-app/package.json` and lockfile for `jose`.

### Shared Spite document/client code

- Create `nexoclip-app/services/spite/lib/realtime/document.ts`: Yjs schema, import, migration, projection conversion.
- Create `nexoclip-app/services/spite/lib/realtime/react-flow-binding.ts`: granular React Flow-to-Yjs commands and derived rendering.
- Create `nexoclip-app/services/spite/lib/realtime/presence.ts`: participant identity, colors, throttling, presence types.
- Create corresponding `*.test.ts` files under `lib/realtime/`.
- Create `nexoclip-app/services/spite/hooks/use-realtime-canvas.ts`: provider lifecycle, JWT refresh, observers, status, Awareness.
- Create `nexoclip-app/services/spite/components/canvas/realtime-presence.tsx`: cursors, labels, selections, lock indicators.

### Realtime process

- Create `nexoclip-app/services/spite/realtime/db.ts`: long-lived Neon pool.
- Create `nexoclip-app/services/spite/realtime/yjs-repository.ts`: ownership, hydration, append, compaction, migration persistence.
- Create `nexoclip-app/services/spite/realtime/projector.ts`: idempotent relational projection.
- Create `nexoclip-app/services/spite/realtime/project-runtime.ts`: per-project serialization, queue, retries, compaction/projection scheduling.
- Create `nexoclip-app/services/spite/realtime/auth.ts`: JWT verification and room binding.
- Create `nexoclip-app/services/spite/realtime/internal-auth.ts`: HMAC verification and nonce replay prevention.
- Create `nexoclip-app/services/spite/realtime/server.ts`: Hocuspocus hooks, health/internal HTTP, shutdown.
- Create integration tests under `nexoclip-app/services/spite/realtime/*.test.ts` and `*.integration.test.ts`.

### Existing Spite boundaries

- Modify `services/spite/components/canvas/canvas-workspace.tsx`: consume Yjs-derived state and commands.
- Modify mutation-bearing node/edge components to use Yjs commands instead of React Flow setters.
- Modify `components/canvas/canvas-toolbar.tsx`: durable persistence statuses.
- Retire active use of `hooks/use-canvas-auto-save.ts`.
- Modify project/canvas/snapshot/duplicate/generation APIs so no server path writes projection as authoritative state.
- Add shared authenticated user lookup for ordinary Spite HTTP routes via the main app session endpoint.
- Modify `database-setup.sql` with Yjs and nonce tables.

### Deployment

- Modify Spite package/lockfile and Dockerfile for Node 22/Hocuspocus.
- Add realtime and migration services to Compose.
- Route `/spite/ws` to realtime and deny public internal auth in Caddy.
- Add environment examples and deployment contract tests.

---

### Task 1: Install and Pin Realtime Dependencies

**Files:**
- Modify: `nexoclip-app/services/spite/package.json`
- Modify: `nexoclip-app/services/spite/pnpm-lock.yaml`
- Modify: `nexoclip-app/package.json`
- Modify: `nexoclip-app/package-lock.json`

**Interfaces:**
- Produces: Yjs/Hocuspocus/jose imports used by all later tasks.

- [ ] **Step 1: Add dependency contract assertions**

Extend `nexoclip-app/tests/deployment/dockerDeployment.test.mjs` to assert Spite declares matching `@hocuspocus/provider` and `@hocuspocus/server` majors, `yjs`, and `jose`, and main declares `jose`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd nexoclip-app && node --test tests/deployment/dockerDeployment.test.mjs`

Expected: FAIL because dependencies are absent.

- [ ] **Step 3: Install pinned compatible dependencies**

Run:

```bash
cd nexoclip-app/services/spite
pnpm add @hocuspocus/provider@4.6.0 @hocuspocus/server@4.6.0 yjs@13.6.32 y-protocols@1.0.7 jose@6.2.12
cd ../..
npm install jose@6.2.12
```

Add scripts to Spite:

```json
"realtime": "tsx realtime/server.ts",
"test:realtime": "tsx --test \"lib/realtime/**/*.test.ts\" \"realtime/**/*.test.ts\""
```

- [ ] **Step 4: Verify GREEN**

Run the focused deployment test and `cd nexoclip-app/services/spite && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add nexoclip-app/package.json nexoclip-app/package-lock.json nexoclip-app/services/spite/package.json nexoclip-app/services/spite/pnpm-lock.yaml nexoclip-app/tests/deployment/dockerDeployment.test.mjs
git commit -m "build(spite): add realtime dependencies"
```

### Task 2: Define the Authoritative Yjs Document Model

**Files:**
- Create: `nexoclip-app/services/spite/lib/realtime/document.test.ts`
- Create: `nexoclip-app/services/spite/lib/realtime/document.ts`

**Interfaces:**
- Produces:
  - `CURRENT_SCHEMA_VERSION: number`
  - `createCanvasDocument(): Y.Doc`
  - `parseProjectDocumentName(name: string): string`
  - `importLegacyCanvas(doc, input): void`
  - `readCanvasProjection(doc): CanvasProjection`
  - `migrateCanvasDocument(doc, fromVersion): boolean`
  - `upsertNode`, `patchNode`, `deleteNode`, `upsertEdge`, `deleteEdge`, `setScenes`, `setActiveSceneId`.

- [ ] **Step 1: Write failing document tests**

Test nested `Y.Map` nodes/edges, separate position fields, scene metadata, exclusion of `selected`/`dragging`/`measured`, round-trip projection, valid `project:<uuid>` parsing, schema version, independent concurrent edits, same-field convergence, and delete-versus-edit convergence using two synchronized Yjs docs.

- [ ] **Step 2: Verify RED**

Run: `cd nexoclip-app/services/spite && pnpm exec tsx --test lib/realtime/document.test.ts`

Expected: FAIL because `document.ts` does not exist.

- [ ] **Step 3: Implement the minimum document codec**

Use top-level maps `nodes`, `edges`, and `meta`. Store every node/edge as a nested `Y.Map`; store `positionX`/`positionY` separately; serialize only durable fields. Implement deterministic conversion to React Flow arrays.

- [ ] **Step 4: Verify GREEN and refactor**

Run the focused test, then all Spite tests.

- [ ] **Step 5: Commit**

```bash
git add nexoclip-app/services/spite/lib/realtime
git commit -m "feat(spite): define Yjs canvas document"
```

### Task 3: Add Durable Neon Schema

**Files:**
- Modify: `nexoclip-app/services/spite/database-setup.sql`
- Create: `nexoclip-app/services/spite/lib/realtime/schema.test.ts`
- Create: `nexoclip-app/services/spite/scripts/migrate-realtime.mjs`

**Interfaces:**
- Produces tables `canvas_yjs_documents`, `canvas_yjs_updates`, and `canvas_auth_nonces` with project cascades and sequence constraints.

- [ ] **Step 1: Write failing schema contract tests**

Read `database-setup.sql` and assert exact required columns, composite update primary key, `snapshot_seq <= durable_seq`, `projected_seq <= durable_seq`, and nonce uniqueness/expiry.

- [ ] **Step 2: Verify RED**

Run the schema test and confirm missing-table assertions fail.

- [ ] **Step 3: Add idempotent SQL**

Add the approved schema. `canvas_auth_nonces` contains `nonce text PRIMARY KEY`, `created_at timestamptz`, and `expires_at timestamptz`; index expiry for cleanup. Do not add cross-database user foreign keys.

- [ ] **Step 4: Add explicit migration runner**

Make `migrate-realtime.mjs` read and execute `database-setup.sql` against `DATABASE_URL` using a Neon `Pool`, fail closed, and exit nonzero on failure.

- [ ] **Step 5: Verify GREEN and commit**

Run focused tests and commit as `feat(spite): add durable Yjs schema`.

### Task 4: Implement Repository Hydration, Ordered Append, and One-Time Import

**Files:**
- Create: `nexoclip-app/services/spite/realtime/db.ts`
- Create: `nexoclip-app/services/spite/realtime/yjs-repository.ts`
- Create: `nexoclip-app/services/spite/realtime/yjs-repository.test.ts`
- Create: `nexoclip-app/services/spite/realtime/yjs-repository.integration.test.ts`

**Interfaces:**
- Produces `YjsRepository` with:
  - `ownsProject(projectId, userId): Promise<boolean>`
  - `loadOrImport(projectId): Promise<{doc, snapshotSeq, durableSeq, projectedSeq}>`
  - `appendUpdate(projectId, update): Promise<number>`
  - `compact(projectId, snapshot, includedSeq, schemaVersion): Promise<void>`
  - `loadProjectionLag(): Promise<ProjectSequence[]>`
  - `close(): Promise<void>`.

- [ ] **Step 1: Write failing repository unit tests against an injected transaction adapter**

Assert ownership uses both IDs; hydration applies updates ordered after `snapshot_seq`; append locks the document row, allocates `durable_seq + 1`, and commits both insert/counter; compaction deletes only `seq <= includedSeq`; existing documents never query legacy tables.

- [ ] **Step 2: Verify RED**

Run the repository unit test and confirm missing implementation failure.

- [ ] **Step 3: Implement repository with a persistent Neon Pool**

Use explicit `BEGIN`/`COMMIT`/`ROLLBACK`, row lock plus the project advisory lock, parameterized queries, and `Y.applyUpdate`. On missing document, read legacy nodes/edges/scenes under the same lock, create one Y.Doc, and persist its initial snapshot exactly once.

- [ ] **Step 4: Add opt-in Neon integration tests**

Guard destructive tests behind `SPITE_TEST_DATABASE_URL`. Verify concurrent appends create contiguous per-project sequences, projects do not share counters, failed transactions do not advance `durable_seq`, concurrent first hydration imports once, and snapshot+updates reconstruct identically.

- [ ] **Step 5: Verify GREEN and commit**

Run unit tests; run integration tests when `SPITE_TEST_DATABASE_URL` exists. Commit as `feat(spite): persist ordered Yjs updates`.

### Task 5: Implement Idempotent Projection

**Files:**
- Create: `nexoclip-app/services/spite/realtime/projector.ts`
- Create: `nexoclip-app/services/spite/realtime/projector.test.ts`

**Interfaces:**
- Produces `projectDocument(projectId, doc, targetSeq): Promise<void>`.

- [ ] **Step 1: Write failing projection tests**

Assert one transaction replaces/upserts nodes and edges, updates scenes/active scene/project timestamp, and advances `projected_seq` only on success. Assert stale target sequences no-op and projection does not mutate encoded Yjs state.

- [ ] **Step 2: Verify RED**

Run the focused test.

- [ ] **Step 3: Implement projection**

Use `readCanvasProjection`; lock the document row; compare `targetSeq` to `projected_seq`; rewrite compatibility tables and metadata transactionally; update `projected_seq` last within the same transaction.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `feat(spite): project Yjs canvas state`.

### Task 6: Implement Per-Project Durability Runtime and Backpressure

**Files:**
- Create: `nexoclip-app/services/spite/realtime/project-runtime.ts`
- Create: `nexoclip-app/services/spite/realtime/project-runtime.test.ts`

**Interfaces:**
- Produces `ProjectRuntime` methods `enqueue`, `canAcceptMutation`, `flush`, `scheduleProjection`, `compact`, and `shutdown`; emits `SYNCED | PERSISTING | PERSISTED | DEGRADED | READ_ONLY`.

- [ ] **Step 1: Write failing runtime tests with injected clock/repository**

Cover 25–100 ms merge batching, byte/count bounds, exponential retry with jitter, `DEGRADED -> READ_ONLY`, mutation rejection while Awareness remains independent, recovery after flush, periodic/debounced snapshot triggers, exact snapshot sequence boundary, projection retry, and serialized unload.

- [ ] **Step 2: Verify RED**

Run the focused test.

- [ ] **Step 3: Implement minimal per-project queue**

Use one promise/mutex chain per project, `Y.mergeUpdates`, bounded bytes/count from environment, and independent projection debounce. Never serialize unrelated projects globally.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `feat(spite): add durable room runtime`.

### Task 7: Implement HMAC Canvas Authorization and JWT Policy

**Files:**
- Create: `nexoclip-app/src/lib/realtime/internalAuth.js`
- Create: `nexoclip-app/src/lib/realtime/token.js`
- Create: `nexoclip-app/tests/realtime/internalAuth.test.mjs`
- Create: `nexoclip-app/services/spite/realtime/internal-auth.ts`
- Create: `nexoclip-app/services/spite/realtime/auth.ts`
- Create: `nexoclip-app/services/spite/realtime/auth.test.ts`

**Interfaces:**
- Main produces `signCanvasAuthorization(payload, secret)` and `issueRealtimeToken({userId, projectId}, secret)`.
- Realtime produces `authorizeInternalRequest` and `verifyRealtimeToken(token, expectedProjectId)`.

- [ ] **Step 1: Write failing crypto contract tests**

Test canonical field order, altered payload rejection, constant-time signature comparison, stale/future timestamp rejection, nonce replay rejection, and JWT rejection for wrong algorithm/signature/issuer/audience/expiry/project.

- [ ] **Step 2: Verify RED in both packages**

Run main and Spite focused tests.

- [ ] **Step 3: Implement fixed-policy cryptography**

Use Web/Node crypto HMAC SHA-256 for internal authorization and `jose` for JWT. Pin `HS256`, issuer, audience, and 60-second expiry. Store nonces atomically in Neon before ownership query; delete expired nonces opportunistically.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `feat(auth): secure realtime authorization`.

### Task 8: Add the Main Realtime Token Endpoint

**Files:**
- Create: `nexoclip-app/app/api/auth/realtime-token/route.js`
- Create: `nexoclip-app/tests/realtime/realtimeTokenRoute.test.mjs`

**Interfaces:**
- Produces `POST /api/auth/realtime-token -> {token, expiresAt}`.

- [ ] **Step 1: Write failing route tests**

Using a dependency-injected handler factory, test invalid session `401`, malformed UUID `400`, absent configuration `503`, Canvas Auth denial `403`, upstream failure `502`, browser `userId` ignored, signed trusted request content, and correct JWT response only after authorization.

- [ ] **Step 2: Verify RED**

Run: `cd nexoclip-app && node --test tests/realtime/realtimeTokenRoute.test.mjs`.

- [ ] **Step 3: Implement route**

Read `nexoclip_session`, call `getCurrentSession`, accept only `projectId`, call private `CANVAS_AUTH_URL`, and issue the JWT only on explicit authorization. Never relay internal URLs/secrets/errors.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `feat(auth): issue realtime canvas tokens`.

### Task 9: Build the Hocuspocus Service

**Files:**
- Create: `nexoclip-app/services/spite/realtime/server.ts`
- Create: `nexoclip-app/services/spite/realtime/server.test.ts`

**Interfaces:**
- Produces persistent WebSocket endpoint and private `/internal/authorize` plus `/healthz` HTTP endpoints.

- [ ] **Step 1: Write failing server integration tests**

Start on an ephemeral port. Assert auth failure occurs before repository hydration; wrong room binding fails; valid owner joins; more than three clients join; two clients converge; durable stateless acknowledgment follows repository commit; reconnect token callback runs again; read-only rejects document mutations but not Awareness; disconnect removes Awareness.

- [ ] **Step 2: Verify RED**

Run the focused server test.

- [ ] **Step 3: Implement Hocuspocus hooks**

Wire `onAuthenticate`, `onLoadDocument`, `beforeSync`, `onChange`, `beforeHandleAwareness`, `onDisconnect`, and `beforeUnloadDocument` to repository/runtime. Sanitize user identity from auth context, assign `Guest N` by participant ID, observe lock heartbeat server-side, and send persistence statuses as stateless messages.

- [ ] **Step 4: Implement graceful shutdown**

On SIGTERM/SIGINT stop new connections, mark active rooms read-only, flush queues, compact if time allows, destroy Hocuspocus, and close Neon pool.

- [ ] **Step 5: Verify GREEN and commit**

Commit as `feat(spite): serve collaborative Yjs rooms`.

### Task 10: Add Same-Origin Spite HTTP Identity and Ownership

**Files:**
- Create: `nexoclip-app/services/spite/lib/main-session.ts`
- Create: `nexoclip-app/services/spite/lib/main-session.test.ts`
- Modify: `nexoclip-app/services/spite/middleware.ts`
- Modify: project-scoped routes under `services/spite/app/api/projects/`, asset/folder routes, and generation routes accepting project IDs.

**Interfaces:**
- Produces `getAuthenticatedUser(request): Promise<{id: string} | null>` by forwarding only `nexoclip_session` to configured main-app session introspection; route helpers enforce `projects.userid`.

- [ ] **Step 1: Write failing identity tests**

Assert only the named cookie is forwarded, client-supplied identity headers are discarded, unavailable/invalid introspection fails closed, and trusted user ID is returned.

- [ ] **Step 2: Verify RED**

Run the focused test.

- [ ] **Step 3: Implement session introspection**

Call the private/main `GET /api/auth/session` through `NEXOCLIP_INTERNAL_URL`, forwarding the session cookie. Strip inbound `x-nexoclip-user-id`; inject the verified value into the request forwarded by middleware or call the helper in handlers.

- [ ] **Step 4: Write failing ownership route tests**

Cover project create/list/get/update/delete, duplicate, canvas reads, assets/folders, and generation project mutations. Non-owner requests must return `404` or `403` without leaking existence.

- [ ] **Step 5: Add ownership predicates**

Remove `DEFAULT_USER_ID`; use trusted user ID for project creation and duplication; constrain every project query/mutation by `userid`. Keep the internal auth path inaccessible to normal browser auth and independently HMAC-protected.

- [ ] **Step 6: Verify GREEN and commit**

Commit as `fix(spite): enforce project ownership`.

### Task 11: Add One-Time Placeholder Ownership Migration

**Files:**
- Create: `nexoclip-app/scripts/migrate-spite-ownership.mjs`
- Create: `nexoclip-app/tests/realtime/spiteOwnershipMigration.test.mjs`

**Interfaces:**
- Produces a one-shot script using both DB URLs; long-running services retain only their own DB credential.

- [ ] **Step 1: Write failing migration tests with injected DB adapters**

Assert the script chooses the configured admin user or deterministic first user, updates only placeholder-owned Spite projects, records a migration marker, and is idempotent.

- [ ] **Step 2: Verify RED**

Run the focused main test.

- [ ] **Step 3: Implement migration**

Require explicit `SPITE_OWNER_USER_ID` in production; allow deterministic first-user lookup only when deliberately configured. Update placeholder UUID rows transactionally and record completion.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `feat(spite): migrate legacy project ownership`.

### Task 12: Implement the React Flow/Yjs Binding

**Files:**
- Create: `nexoclip-app/services/spite/lib/realtime/react-flow-binding.test.ts`
- Create: `nexoclip-app/services/spite/lib/realtime/react-flow-binding.ts`
- Create: `nexoclip-app/services/spite/hooks/use-realtime-canvas.ts`

**Interfaces:**
- Produces `useRealtimeCanvas(projectId)` returning derived `nodes`, `edges`, `scenes`, `activeSceneId`, mutation commands, `undo`, `redo`, Awareness peers, and persistence status.

- [ ] **Step 1: Write failing binding tests**

Assert local node/edge changes update Yjs, observers derive fresh arrays without writing back, hidden-scene nodes are retained, ephemeral React Flow fields are not persisted, remote updates render, and `Y.UndoManager` tracks local origin only.

- [ ] **Step 2: Verify RED**

Run the focused test.

- [ ] **Step 3: Implement command adapter**

Wrap `applyNodeChanges`/`applyEdgeChanges`, diff changed IDs, and write granular transactions. Provide commands for create/patch/delete/duplicate/connect, scene add/delete/switch, and batch operations. Observers only publish render projections.

- [ ] **Step 4: Implement provider hook**

Create one Y.Doc/provider per project. Provider token callback POSTs `/api/auth/realtime-token` for every connection/reconnect. Parse stateless durable status messages. Do not fetch legacy canvas REST state from the browser.

- [ ] **Step 5: Verify GREEN and commit**

Commit as `feat(spite): bind React Flow to Yjs`.

### Task 13: Integrate Awareness, Cursor Rendering, and Soft Locks

**Files:**
- Create: `nexoclip-app/services/spite/lib/realtime/presence.test.ts`
- Create: `nexoclip-app/services/spite/lib/realtime/presence.ts`
- Create: `nexoclip-app/services/spite/components/canvas/realtime-presence.tsx`
- Modify: `nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx`

**Interfaces:**
- Consumes `useRealtimeCanvas` Awareness API.
- Produces per-tab participant, deterministic color, cursor/selection presence, and drag lock UX.

- [ ] **Step 1: Write failing presence tests**

Test same-tab reload stability, distinct-tab IDs, deterministic colors, cursor throttling, and server-time lock expiration semantics.

- [ ] **Step 2: Verify RED**

Run the focused test.

- [ ] **Step 3: Implement presence utilities and renderer**

Store participant ID in `sessionStorage`; publish cursor every 30–60 ms, selection changes, and drag lock start/heartbeat/stop. Render remote cursors, `Guest N`, selections, and “is editing” hints without storing them in Y.Doc.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `feat(spite): show realtime canvas presence`.

### Task 14: Move Every Canvas Mutation to Yjs

**Files:**
- Modify: `components/canvas/canvas-workspace.tsx`
- Modify: `components/canvas/nodes/image-node.tsx`
- Modify: `components/canvas/nodes/video-node.tsx`
- Modify: `components/canvas/nodes/reference-node.tsx`
- Modify: `components/canvas/nodes/prompt-node.tsx`
- Modify: `components/canvas/nodes/comment-node.tsx`
- Modify: `components/canvas/nodes/sticker-node.tsx`
- Modify: `components/canvas/nodes/compress-node.tsx`
- Modify: `components/canvas/nodes/node-toolbar.tsx`
- Modify: `components/canvas/connected-inputs.tsx`
- Modify: `components/canvas/edges/scissors-edge.tsx`
- Modify: relevant focused tests.

**Interfaces:**
- Consumes Yjs mutation commands through a canvas collaboration context.

- [ ] **Step 1: Add failing mutation coverage**

For each mutation category—drag, resize, add, connect, delete, duplicate, clipboard, scene delete, generation data patch, shot assignment, disconnect, and edge cut—assert a Yjs transaction changes the authoritative document and no direct React Flow durable setter is required.

- [ ] **Step 2: Verify RED**

Run focused canvas binding/component tests.

- [ ] **Step 3: Replace workspace mutations**

Remove `useNodesState`, `useEdgesState`, local durable scenes, legacy initial canvas fetch, and whole-array undo history. Consume derived state and Yjs commands. Keep viewport local.

- [ ] **Step 4: Replace child component mutations**

Route every direct `setNodes`, `setEdges`, `addNodes`, `addEdges`, and `deleteElements` durable mutation through the collaboration context. Audit component-local state so remote data refreshes controls without a local effect overwriting remote changes.

- [ ] **Step 5: Verify no bypass remains**

Search mutation-bearing files for direct React Flow durable setters; only derived render updates in the binding may remain. Run all Spite tests and TypeScript.

- [ ] **Step 6: Commit**

Commit as `refactor(spite): make Yjs canvas authoritative`.

### Task 15: Replace Autosave with Durable Status

**Files:**
- Modify: `services/spite/components/canvas/canvas-toolbar.tsx`
- Modify/Delete: `services/spite/hooks/use-canvas-auto-save.ts`
- Modify: `services/spite/components/canvas/canvas-workspace.tsx`
- Create/Modify: toolbar tests.

**Interfaces:**
- Consumes runtime states `SYNCED`, `PERSISTING`, `PERSISTED`, `DEGRADED`, `READ_ONLY`.

- [ ] **Step 1: Write failing save-status tests**

Assert “Saved” only for durable `PERSISTED`, pending/degraded/read-only labels are distinct, and read-only disables document mutation while retaining presence.

- [ ] **Step 2: Verify RED**

Run focused tests.

- [ ] **Step 3: Remove legacy autosave path**

Delete debounce/interval/beacon calls and map stateless server acknowledgments into toolbar state. Remove the hook if no caller remains.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `refactor(spite): replace canvas autosave`.

### Task 16: Convert Server-Side Canvas Writers

**Files:**
- Modify: `services/spite/lib/r2-upload.ts`
- Modify: `services/spite/app/api/generate/submit/route.ts`
- Modify: `services/spite/app/api/generate/status/route.ts`
- Modify: `services/spite/app/api/generate/recover/route.ts`
- Modify: snapshot restore and duplicate routes.
- Create: `services/spite/lib/realtime/internal-client.ts`
- Add focused tests.

**Interfaces:**
- Produces a private authenticated realtime mutation endpoint/client for trusted server updates.

- [ ] **Step 1: Write failing tests for generation, restore, and duplication**

Assert generation completion/pending cleanup patches Yjs, snapshot restore applies a Yjs transaction, duplication initializes a new Yjs document, and none directly update/copy `canvas_nodes` as authoritative state.

- [ ] **Step 2: Verify RED**

Run focused tests.

- [ ] **Step 3: Add trusted mutation API**

Add a private HMAC-protected realtime endpoint that loads the authoritative document, applies typed node patches or document replacement under the project runtime lock, persists updates, and schedules projection.

- [ ] **Step 4: Move server writers**

Replace projection writes in generation flows and restore. Duplicate authoritative Yjs state; allow projection copy only as the one-time source when duplicating a project that genuinely has no Yjs document.

- [ ] **Step 5: Add projection-lag safety to destructive asset operations**

Before deleting media based on projection references, require `projected_seq = durable_seq` or query the authoritative document through the private realtime API.

- [ ] **Step 6: Verify GREEN and commit**

Commit as `refactor(spite): route server writes through Yjs`.

### Task 17: Lock Legacy APIs to Projection-Only Semantics

**Files:**
- Modify: `services/spite/app/api/projects/[projectId]/canvas/route.ts`
- Modify: `services/spite/app/api/projects/[projectId]/canvas/snapshots/route.ts`
- Modify: tests for both routes.

**Interfaces:**
- GET remains compatibility projection read; POST cannot rewrite authoritative state.

- [ ] **Step 1: Write failing route tests**

Assert canvas GET is marked/treated as projection output, old whole-array POST returns `410 Gone`, and snapshot restore cannot directly mutate projection tables.

- [ ] **Step 2: Verify RED**

Run focused tests.

- [ ] **Step 3: Remove authoritative legacy writes**

Delete whole-array delete/reinsert and JSON snapshot write logic from the legacy POST. Route supported restoration through Task 16’s trusted Yjs mutation API.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `refactor(spite): make legacy canvas read-only`.

### Task 18: Wire Docker, Caddy, Environment, and Health Checks

**Files:**
- Modify: `nexoclip-app/services/spite/Dockerfile`
- Modify: `nexoclip-app/docker-compose.prod.yml`
- Modify: root `docker-compose.yml`
- Modify: `nexoclip-app/Caddyfile`
- Modify: env example files
- Modify: `nexoclip-app/scripts/production-config.mjs`
- Modify: `nexoclip-app/tests/deployment/dockerDeployment.test.mjs`
- Modify: `nexoclip-app/tests/production/productionConfig.test.mjs`

**Interfaces:**
- Produces private realtime service, migration jobs, same-origin WebSocket route, and secret isolation.

- [ ] **Step 1: Extend failing deployment tests**

Assert Node 22 realtime target, private realtime port, `/spite/ws` route before `/spite*`, blocked `/spite/api/internal/*`, main-only session DB, realtime-only Spite DB, correct JWT/HMAC sharing, migrations before startup, health checks, queue defaults, and no public internal auth route.

- [ ] **Step 2: Verify RED**

Run deployment/config tests.

- [ ] **Step 3: Implement Docker and proxy wiring**

Add realtime and one-shot migration/ownership jobs. Route WebSocket upgrades through Caddy and explicitly respond `404` to public internal paths. Do not publish realtime container ports.

- [ ] **Step 4: Add documented environment variables**

Add `CANVAS_AUTH_URL`, `CANVAS_AUTH_HMAC_SECRET`, `REALTIME_JWT_SECRET`, `NEXOCLIP_INTERNAL_URL`, `NEXT_PUBLIC_REALTIME_URL`, queue byte/count limits, flush/compaction intervals, and ownership migration input without secret values.

- [ ] **Step 5: Verify GREEN and commit**

Commit as `build(spite): deploy realtime canvas service`.

### Task 19: End-to-End Collaboration and Recovery Verification

**Files:**
- Create: `nexoclip-app/services/spite/realtime/collaboration.integration.test.ts`
- Create/Modify: Playwright realtime canvas spec if Playwright harness exists; otherwise provide a deterministic multi-provider integration test.
- Modify: operational runbook/README with migration and recovery commands.

**Interfaces:**
- Verifies the complete approved architecture without changing it.

- [ ] **Step 1: Write failing end-to-end scenarios**

Cover two participants moving different nodes, same-field convergence, delete/edit convergence, participant IDs per tab, disconnect presence cleanup, more than three clients, JWT refresh on reconnect, hard restart recovery from snapshot+updates, projection catch-up, and Neon outage read-only/recovery.

- [ ] **Step 2: Verify RED**

Run the focused integration suite and confirm missing integration behavior fails.

- [ ] **Step 3: Complete only missing glue found by the scenarios**

Do not introduce alternate persistence/auth/state paths. Fix through the established repository, runtime, binding, or deployment boundaries.

- [ ] **Step 4: Run full verification**

```bash
cd nexoclip-app
node --test tests/realtime/*.test.mjs tests/deployment/dockerDeployment.test.mjs tests/production/productionConfig.test.mjs
npm run build
cd services/spite
pnpm test
pnpm exec tsc --noEmit
pnpm run build
```

When `SPITE_TEST_DATABASE_URL` is configured, also run all realtime integration tests. Validate Compose config and Caddy config through the deployment tests.

- [ ] **Step 5: Review projection/source boundaries**

Search for writes to `canvas_nodes`, `canvas_edges`, `projects.scenes`, and `active_scene_id`. Confirm only projector, initial schema/migration, and explicitly retired legacy code touch them; confirm no client REST hydration or whole-array autosave remains.

- [ ] **Step 6: Commit**

```bash
git add nexoclip-app docs
git commit -m "test(spite): verify realtime CRDT canvas"
```
