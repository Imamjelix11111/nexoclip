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
- Ownership is checked before room access or hydration and repeated by Hocuspocus; unauthenticated clients receive no Y.Doc or persisted state regardless of hook ordering.
- `PERSISTED` and its client acknowledgment mean the corresponding Yjs update has committed successfully to Neon: update → enqueue → Neon COMMIT → `PERSISTED` → ACK.
- Every trusted HTTP server mutation enters `ProjectRuntime`, applies a Y.Doc transaction, follows the normal durable update pipeline, and schedules projection; it never updates projection tables directly or saves a whole snapshot per mutation.
- Three participants is a target, never a hard limit.
- Neon failure uses a bounded queue and transitions document mutation to read-only while Awareness remains available.
- Database credentials are isolated: Main App gets only its main database URL; Spite Realtime gets only the Spite database URL; Spite HTTP gets neither the main database URL nor browser-visible database credentials.
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

### Task 0: Read-Only Repository Reconnaissance

**Files:**
- Read only: package manifests and lockfiles
- Read only: Spite application and realtime-adjacent entrypoints
- Read only: canvas workspace, node/edge components, autosave hooks, REST routes, project ownership, generation routes, database schema, Docker/Compose/Caddy, and test configuration
- Create only as execution artifact: `docs/superpowers/plans/2026-09-08-spite-realtime-reconnaissance.md`

**Interfaces:**
- Produces a verified repository map used to validate file paths and implementation assumptions in Tasks 1–20.
- Must not redesign the locked architecture or modify application/configuration files.

- [ ] **Step 1: Inspect package and runtime boundaries**

Record package managers, dependency versions, Node versions, Next.js entrypoints, service boundaries, build targets, and existing test commands.

- [ ] **Step 2: Trace current canvas state and every mutation path**

Trace initial hydration, React Flow ownership, autosave, nodes, edges, scenes, undo/redo, child-component setters, generation callbacks, restore, duplication, and destructive asset checks.

- [ ] **Step 3: Trace authentication, authorization, persistence, and deployment**

Map the main custom session, Spite session middleware, ownership predicates or gaps, Neon schema, project lifecycle, Compose environment wiring, and Caddy routes.

- [ ] **Step 4: Write the reconnaissance report**

The report must contain exactly these sections:

1. Current architecture map
2. Existing mutation paths
3. Existing persistence paths
4. Existing auth/session paths
5. Existing deployment paths
6. Conflicts with this implementation plan
7. Files that differ from the proposed file map

Do not edit production files. If a file path or assumption differs, update this plan before Task 1 without changing the five locked invariants.

- [ ] **Step 5: Review checkpoint**

Confirm the repository still has no unintended changes beyond the report. Commit the report only at this milestone if granular plan commits are being used.

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
- Produces `captureProjectionPayload(doc): CanvasProjection`.
- Produces `projectDocument(projectId, projectionPayload, targetSeq): Promise<void>`.

- [ ] **Step 1: Write failing projection tests**

Assert one transaction replaces/upserts nodes and edges, updates scenes/active scene/project timestamp, and advances `projected_seq` only on success. Assert stale target sequences no-op, immutable captured payloads do not drift while projection waits on slow database work, coalesced older exact payloads may still project while `durable_seq` is newer, and capture does not mutate encoded Yjs state.

- [ ] **Step 2: Verify RED**

Run the focused test.

- [ ] **Step 3: Implement projection**

Expose immutable capture separately with `captureProjectionPayload(doc)` at the durable boundary. `projectDocument(projectId, projectionPayload, targetSeq)` locks the document row, no-ops when `targetSeq <= projected_seq`, rejects only when `targetSeq > durable_seq`, permits idempotent projection of an exact older captured payload when `targetSeq < durable_seq`, rewrites compatibility tables and metadata transactionally, and updates `projected_seq` last within the same transaction.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `feat(spite): project Yjs canvas state`.

### Task 6: Implement Per-Project Durability Runtime and Backpressure

**Files:**
- Create: `nexoclip-app/services/spite/realtime/project-runtime.ts`
- Create: `nexoclip-app/services/spite/realtime/project-runtime.test.ts`

**Interfaces:**
- Produces `ProjectRuntime` methods `enqueue`, `canAcceptMutation`, `flush`, `scheduleProjection`, `compact`, and `shutdown`; emits `SYNCED | PERSISTING | PERSISTED | DEGRADED | READ_ONLY`.
- `scheduleProjection` captures an immutable `CanvasProjection` payload at the exact durable sequence boundary before any slow projection work.

- [ ] **Step 1: Write failing runtime tests with injected clock/repository**

Cover 25–100 ms merge batching, byte/count bounds, exponential retry with jitter, `DEGRADED -> READ_ONLY`, mutation rejection while Awareness remains independent, recovery after flush, periodic/debounced snapshot triggers, exact snapshot sequence boundary, projection retry, and serialized unload.

- [ ] **Step 2: Verify RED**

Run the focused test.

- [ ] **Step 3: Implement minimal per-project queue**

Use one promise/mutex chain per project, `Y.mergeUpdates`, bounded bytes/count from environment, and independent projection debounce. Never serialize unrelated projects globally.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `feat(spite): add durable room runtime`.

### Task 7: Implement Crypto and Token Policy Only

**Files:**
- Create: `nexoclip-app/src/lib/realtime/internalAuth.js`
- Create: `nexoclip-app/src/lib/realtime/token.js`
- Create: `nexoclip-app/tests/realtime/internalAuth.test.mjs`
- Create: `nexoclip-app/services/spite/realtime/internal-auth.ts`
- Create: `nexoclip-app/services/spite/realtime/auth.ts`
- Create: `nexoclip-app/services/spite/realtime/auth.test.ts`

**Interfaces:**
- Produces crypto/policy functions only:
  - `signCanvasAuthorization(payload, secret)`
  - `verifyCanvasAuthorization(payload, signature, secret)`
  - `issueRealtimeToken({userId, projectId}, secret)`
  - `verifyRealtimeToken(token, expectedProjectId, secret)`
- Does not create HTTP routes, call session services, query ownership, or orchestrate Canvas Auth requests.

- [ ] **Step 1: Write failing crypto contract tests**

Test canonical field order, altered payload rejection, constant-time signature comparison, stale/future timestamp rejection, and JWT rejection for wrong algorithm/signature/issuer/audience/expiry/project. Durable nonce insertion/replay orchestration belongs to the private Canvas Auth HTTP boundary, not this crypto-only task.

- [ ] **Step 2: Verify RED in both packages**

Run main and Spite focused tests.

- [ ] **Step 3: Implement fixed-policy cryptography**

Use Web/Node crypto HMAC SHA-256 for internal authorization and `jose` for JWT. Pin `HS256`, issuer, audience, and 60-second expiry. Keep all functions transport-independent and side-effect-free; nonce persistence is implemented by the private Canvas Auth endpoint in Task 9.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `feat(auth): secure realtime authorization`.

### Task 8: Add the Main Realtime Token Endpoint

**Files:**
- Create: `nexoclip-app/app/api/auth/realtime-token/route.js`
- Create: `nexoclip-app/tests/realtime/realtimeTokenRoute.test.mjs`

**Interfaces:**
- Consumes Task 7 crypto/policy functions without reimplementing them.
- Produces HTTP orchestration only: `POST /api/auth/realtime-token -> {token, expiresAt}`.
- Owns session lookup, request `projectId` validation, signed Canvas Auth request, error mapping, and response serialization.

- [ ] **Step 1: Write failing route tests**

Using a dependency-injected handler factory, test invalid session `401`, malformed UUID `400`, absent configuration `503`, Canvas Auth denial `403`, upstream failure `502`, browser `userId` ignored, signed trusted request content, and correct JWT response only after authorization.

- [ ] **Step 2: Verify RED**

Run: `cd nexoclip-app && node --test tests/realtime/realtimeTokenRoute.test.mjs`.

- [ ] **Step 3: Implement route**

Read `nexoclip_session`, call `getCurrentSession`, accept only `projectId`, call private `CANVAS_AUTH_URL`, and issue the JWT only on explicit authorization. Never relay internal URLs/secrets/errors.

- [ ] **Step 4: Verify GREEN and commit**

Commit as `feat(auth): issue realtime canvas tokens`.

### Task 9: Build the Hocuspocus Core

**Files:**
- Create: `nexoclip-app/services/spite/realtime/server.ts`
- Create: `nexoclip-app/services/spite/realtime/server-core.test.ts`

**Interfaces:**
- Produces the persistent WebSocket server core and private `/internal/authorize` plus `/healthz` HTTP endpoints.
- Consumes Task 4 repository, Task 6 runtime, and Task 7 crypto policy.

- [ ] **Step 1: Write failing lifecycle-order security tests against the pinned Hocuspocus version**

Start a real server on an ephemeral port and instrument authorization, room access, hydration, and outbound sync. Assert the security invariant rather than assuming hook order: an invalid, expired, non-owner, or wrong-project connection receives no room access, triggers no repository hydration, and receives no Y.Doc/persisted state bytes.

- [ ] **Step 2: Write failing collaboration core tests**

Assert a valid owner joins `project:<projectId>`, hydration occurs only after authorization, more than three clients can join, two clients converge, `onChange` enqueues the exact update into `ProjectRuntime`, and disconnect releases the core connection reference.

- [ ] **Step 3: Verify RED**

Run the focused server-core tests.

- [ ] **Step 4: Implement the minimal core hooks**

Wire authentication, authorization, document loading, change-to-runtime enqueueing, and disconnect cleanup. Implement private Canvas Auth nonce insertion atomically before ownership lookup and reject replay. Do not add Awareness naming, lock policy, status ACKs, or shutdown behavior in this task.

- [ ] **Step 5: Verify GREEN and commit**

Commit as `feat(spite): serve authorized Yjs rooms`.

### Task 10: Add Hocuspocus Lifecycle, Awareness, ACKs, and Shutdown

**Files:**
- Modify: `nexoclip-app/services/spite/realtime/server.ts`
- Create: `nexoclip-app/services/spite/realtime/server-lifecycle.test.ts`

**Interfaces:**
- Extends Task 9 without changing its pre-hydration authorization invariant.
- Produces sanitized Awareness, `Guest N` allocation, server-observed soft-lock lifetime, durable status messages, read-only admission, and graceful shutdown.

- [ ] **Step 1: Write failing Awareness and lifecycle tests**

Assert forged `userId`/name is replaced from authenticated context, each `participantId` gets room-scoped `Guest N`, disconnect releases its name, locks expire from server-observed heartbeat rather than browser time, and Awareness still propagates while document mutation is read-only.

- [ ] **Step 2: Write failing durability ACK tests**

Instrument runtime and transport to prove the exact order `Yjs update -> enqueue -> Neon COMMIT -> PERSISTED -> ACK`. Assert no `PERSISTED` ACK is emitted while append is pending or failed, and read-only rejects new document mutations before application.

- [ ] **Step 3: Verify RED**

Run the focused lifecycle tests.

- [ ] **Step 4: Implement Awareness, statuses, and admission control**

Sanitize Awareness from auth context, allocate names by participant, track lock heartbeat with server time, send stateless statuses, and use the pinned Hocuspocus APIs only after tests demonstrate the security/admission lifecycle.

- [ ] **Step 5: Implement and test graceful shutdown**

On SIGTERM/SIGINT stop new connections, mark rooms read-only, flush pending updates to Neon, emit no premature ACK, compact when time permits, destroy Hocuspocus, and close the Neon pool.

- [ ] **Step 6: Verify GREEN and commit**

Commit as `feat(spite): manage realtime room lifecycle`.

### Task 11: Add Same-Origin Spite HTTP Identity and Ownership

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

### Task 12: Add One-Time Placeholder Ownership Migration

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

### Task 13: Implement the React Flow/Yjs Binding

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

### Task 14: Integrate Awareness, Cursor Rendering, and Soft Locks

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

### Task 15: Move Every Canvas Mutation to Yjs

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

### Task 16: Replace Autosave with Durable Status

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

### Task 17: Convert Server-Side Canvas Writers

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
- Every request follows exactly: HTTP authentication/authorization → `ProjectRuntime` → Y.Doc transaction → normal incremental durable persistence → asynchronous projection.
- The endpoint never updates `canvas_nodes`/`canvas_edges` directly and never persists a whole snapshot for each mutation.

- [ ] **Step 1: Write failing tests for generation, restore, and duplication**

Assert generation completion/pending cleanup patches Yjs, snapshot restore applies a Yjs transaction, duplication initializes a new Yjs document, and none directly update/copy `canvas_nodes` as authoritative state.

- [ ] **Step 2: Verify RED**

Run focused tests.

- [ ] **Step 3: Add trusted mutation API**

Add a private HMAC-protected realtime endpoint that validates the request, enters the existing `ProjectRuntime`, applies a typed Y.Doc transaction to its active replica, lets the ordinary incremental update queue reach Neon commit, then schedules projection. Whole-document replacement is permitted only for explicit snapshot restore or project duplication, still as a Yjs transaction through this pipeline; routine mutations must remain granular and must not force a snapshot.

- [ ] **Step 4: Move server writers**

Replace projection writes in generation flows and restore. Duplicate authoritative Yjs state; allow projection copy only as the one-time source when duplicating a project that genuinely has no Yjs document.

- [ ] **Step 5: Add projection-lag safety to destructive asset operations**

Before deleting media based on projection references, require `projected_seq = durable_seq` or query the authoritative document through the private realtime API.

- [ ] **Step 6: Verify GREEN and commit**

Commit as `refactor(spite): route server writes through Yjs`.

### Task 18: Lock Legacy APIs to Projection-Only Semantics

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

### Task 19: Wire Docker, Caddy, Environment, and Health Checks

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

Parse the actual Compose service environment blocks and assert Node 22 realtime target, private realtime port, `/spite/ws` route before `/spite*`, blocked `/spite/api/internal/*`, correct JWT/HMAC sharing, migrations before startup, health checks, queue defaults, and no public internal auth route. Explicitly assert: Main has `DATABASE_URL_NEXOCLIP` but not `DATABASE_URL_SPITE`; realtime has `DATABASE_URL_SPITE` but not `DATABASE_URL_NEXOCLIP`; Spite HTTP has `NEXOCLIP_INTERNAL_URL` but no main database URL; no `NEXT_PUBLIC_*` or browser build argument contains a database credential.

- [ ] **Step 2: Verify RED**

Run deployment/config tests.

- [ ] **Step 3: Implement Docker and proxy wiring**

Add realtime and one-shot migration/ownership jobs. Route WebSocket upgrades through Caddy and explicitly respond `404` to public internal paths. Do not publish realtime container ports. Wire separate Compose variable names so the main service receives only its main database value and realtime receives only the Spite database value; never use a shared generic database secret across these services.

- [ ] **Step 4: Add documented environment variables**

Add `CANVAS_AUTH_URL`, `CANVAS_AUTH_HMAC_SECRET`, `REALTIME_JWT_SECRET`, `NEXOCLIP_INTERNAL_URL`, `NEXT_PUBLIC_REALTIME_URL`, queue byte/count limits, flush/compaction intervals, and ownership migration input without secret values.

- [ ] **Step 5: Verify GREEN and commit**

Commit as `build(spite): deploy realtime canvas service`.

### Task 20: End-to-End Collaboration and Recovery Verification

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

Search for writes to `canvas_nodes`, `canvas_edges`, `projects.scenes`, and `active_scene_id`. Confirm only projector and initial migration/import infrastructure touch them; retired legacy endpoints must contain no executable writes. Confirm no client REST hydration or whole-array autosave remains. Re-run the five invariant checks: persisted Yjs is authoritative, React Flow is derived, legacy tables are projection-only, ACK follows Neon COMMIT, and authorization precedes room access/hydration.

- [ ] **Step 6: Commit**

```bash
git add nexoclip-app docs
git commit -m "test(spite): verify realtime CRDT canvas"
```

## 2026-09-08 Task 7 Round 1 minor gap follow-up

- Added explicit `constantTimeEqual` exports in both isolated Task 7 crypto modules:
  - `nexoclip-app/src/lib/realtime/internalAuth.js`
  - `nexoclip-app/services/spite/realtime/internal-auth.ts`
- Added focused behavioral tests in both suites for:
  - equal strings
  - different lengths
  - mismatch at first byte
  - mismatch at last byte
- Portability preserved: helper stays Web-Crypto-compatible string/byte comparison (no Node-only `timingSafeEqual` swap).
- Intentional duplication remains in place for service isolation; shared package extraction is deferred as minor follow-up by design.

## 2026-09-08 Task 8 Round 1 error-boundary follow-up

- Added failing-first route tests for three unhandled throw/reject paths in `nexoclip-app/tests/realtime/realtimeTokenRoute.test.mjs`:
  - `getSession` rejection
  - `signAuthorization` throw
  - `issueToken` throw
- Added minimal catch boundaries in `nexoclip-app/app/api/auth/realtime-token/route.js`:
  - Session lookup rejection -> safe JSON `502` (`Realtime authorization failed`)
  - Canvas Auth signing failure -> safe JSON `502` (`Realtime authorization failed`)
  - Local JWT issuance failure -> safe JSON `500` (`Realtime token issuance failed`)
- Preserved existing boundary statuses and behavior:
  - unauthenticated `401`
  - invalid `projectId` `400`
  - missing config `503`
  - authorization denied `403`
  - upstream/non-OK Canvas Auth `502`
- Verified no sensitive leakage in new failure paths (error strings/secrets/internal config not returned in body).
- Verification run (focused + Task 7 suites):
  - `cd nexoclip-app && node --test tests/realtime/realtimeTokenRoute.test.mjs tests/realtime/internalAuth.test.mjs`
  - `cd nexoclip-app/services/spite && npx --yes tsx --test realtime/auth.test.ts`

## 2026-09-09 Task 19 Round 2 deploy preflight fix

- Added failing-first deploy contract assertion in `nexoclip-app/tests/deployment/dockerDeployment.test.mjs` to require production env loading before config preflight:
  - `set -a; . ./.env.production; set +a; NODE_ENV=production npm run config:check`
  - preserved ordering guarantee: config check must run before `docker compose ... config --quiet`.
- Updated `nexoclip-app/scripts/deploy.sh` preflight to source `.env.production` safely (after explicit presence check) and run config check with `NODE_ENV=production`.
- Updated runbook command wording in `nexoclip-app/docs/production-runbook.md` to match deploy preflight contract.
- Verification run:
  - `cd nexoclip-app && rtk node --test tests/deployment/dockerDeployment.test.mjs tests/production/productionConfig.test.mjs` ✅
  - `cd nexoclip-app && rtk bash -n scripts/deploy.sh` ✅
  - `cd nexoclip-app && REALTIME_JWT_SECRET=dummy CANVAS_AUTH_URL=http://spite-realtime:3007/internal/authorize NEXOCLIP_INTERNAL_URL=http://nexoclip:3000 NEXT_PUBLIC_REALTIME_URL=/spite/ws rtk docker compose --env-file .env.production.example -f docker-compose.prod.yml config --quiet` ✅
