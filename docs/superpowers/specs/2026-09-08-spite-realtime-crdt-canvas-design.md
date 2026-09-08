# Spite Realtime CRDT Canvas Design

**Date:** 2026-09-08  
**Status:** Approved and locked

## 1. Scope

Add realtime collaboration to the Spite React Flow canvas for a VPS/Docker deployment. Multiple tabs or devices may use the same NexoClip account while retaining independent cursors and selections.

Three concurrent participants is an MVP target, not a hard limit.

## 2. Architecture Contract

### Authentication

```text
Main App
  -> validates nexoclip_session
  -> asks Canvas Auth to authorize userId + projectId

Canvas Auth
  -> verifies signed internal request
  -> checks projects.userid in Neon

Main App
  -> issues short-lived realtime JWT

Hocuspocus
  -> verifies JWT
  -> repeats ownership check before room access
```

### State

- Persisted Yjs state in Neon is authoritative.
- A Hocuspocus `Y.Doc` is an active replica reconstructed from persistence.
- React Flow nodes and edges are derived UI representations.
- `canvas_nodes`, `canvas_edges`, and scene columns are asynchronous compatibility projections.
- Projection state never writes back into Yjs.

### Concurrency

- Yjs CRDT provides correctness and convergence.
- Awareness provides ephemeral presence.
- Soft locks provide UX coordination only and are never authoritative.

## 3. Deployment Topology

```text
https://app.example.com/          -> NexoClip :3000
https://app.example.com/spite/*   -> Spite :3005
https://app.example.com/spite/ws  -> Hocuspocus WebSocket service
```

Both applications use one public origin through a reverse proxy. The `nexoclip_session` cookie remains owned by the main application. Spite and Hocuspocus never receive database credentials for the main user/session database.

## 4. Authentication and Authorization

### 4.1 Token issuance

The main application exposes:

```text
POST /api/auth/realtime-token
Cookie: nexoclip_session
Body: { projectId }
```

Flow:

1. Validate `nexoclip_session` against the main PostgreSQL database.
2. Derive trusted `userId` from the session; never accept it from the browser.
3. Send an internal authorization request containing `userId`, `projectId`, timestamp, and nonce to Canvas Auth.
4. Sign that request with a dedicated HMAC secret.
5. Canvas Auth verifies signature, timestamp, and nonce, then checks `projects.userid = userId` in Neon.
6. Only after approval, issue a realtime JWT with an approximately 60-second lifetime.

The Canvas Auth endpoint is not exposed by the public reverse proxy. Replay protection uses a short timestamp window and nonce tracking.

JWT claims:

```json
{
  "iss": "nexoclip",
  "aud": "nexoclip-realtime",
  "sub": "user-uuid",
  "projectId": "project-uuid",
  "jti": "random-uuid",
  "iat": 1710000000,
  "exp": 1710000060
}
```

`projectId` binds the credential to a handshake context; it does not grant access by itself. Signing and verification pin an explicit algorithm allowlist, initially `HS256`. The realtime JWT secret is separate from session and password secrets.

### 4.2 WebSocket handshake

The mandatory order is:

```text
connect
  -> verify algorithm, signature, issuer, audience, and expiry
  -> verify token projectId matches requested room projectId
  -> query Neon for projects.userid = JWT.sub
  -> authorize
  -> join project:{projectId}
  -> hydrate or reuse active Y.Doc
  -> run Yjs state-vector sync
```

An unauthorized connection must not receive document state. Hydration and room attachment occur only after authorization.

### 4.3 Reconnect

An expired JWT is never reused:

1. Request a new token from the main application.
2. Revalidate the main session and project authorization.
3. Open a new WebSocket connection.
4. Use Yjs state-vector sync to exchange only missing state.

JWTs are not stored in `localStorage`.

## 5. Yjs Document Model

```text
Y.Doc
├── nodes: Y.Map<Y.Map>
├── edges: Y.Map<Y.Map>
└── meta: Y.Map
    ├── scenes
    ├── activeSceneId
    └── schemaVersion
```

Each node and edge uses a nested `Y.Map`. Frequently updated position fields are granular:

```text
nodes[nodeId]
├── type
├── positionX
├── positionY
└── data
```

For MVP, `data` may remain a JSON value where concurrent deep merging is unnecessary.

### React Flow integration

```text
User interaction
  -> granular Y.Doc transaction
  -> Yjs observers
  -> derive React Flow nodes/edges
  -> render
```

Yjs is the only canvas state source. React state is a render projection. Observers never invoke mutation handlers, preventing feedback loops by architecture rather than relying only on transaction origins. Origins such as `LOCAL_ORIGIN` remain useful for diagnostics and selective handling.

The legacy whole-array autosave endpoint must be removed, disabled, or converted into a compatibility adapter that writes Yjs transactions. It cannot overwrite authoritative canvas state.

## 6. Presence and Soft Locks

Awareness contains ephemeral data only:

```ts
{
  participantId: "per-tab-uuid",
  userId: "account-uuid",
  name: "Guest 2",
  color: "#...",
  cursor: { x: 100, y: 250 },
  selection: ["node-123"],
  lock: { nodeId: "node-123", action: "drag" }
}
```

Rules:

- Generate `participantId` with `crypto.randomUUID()` and retain it in `sessionStorage`.
- A single `userId` may have multiple independent participants.
- A room/session manager assigns `Guest N` by `participantId` and may reclaim names after disconnect.
- Color is deterministic from `participantId`.
- Cursor updates are throttled to approximately 30–60 ms.
- Disconnect removes Awareness state.
- Soft locks travel through Awareness but remain transient hints.
- Lock expiry uses server-observed heartbeat/last-seen time. Client timestamps, if sent, are UX hints only.
- Yjs resolves races regardless of lock state.

## 7. Durable Persistence

### 7.1 Schema

```sql
CREATE TABLE canvas_yjs_documents (
  project_id     uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  snapshot       bytea,
  snapshot_seq   bigint NOT NULL DEFAULT 0,
  durable_seq    bigint NOT NULL DEFAULT 0,
  projected_seq  bigint NOT NULL DEFAULT 0,
  schema_version integer NOT NULL DEFAULT 1,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (snapshot_seq <= durable_seq),
  CHECK (projected_seq <= durable_seq)
);

CREATE TABLE canvas_yjs_updates (
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq         bigint NOT NULL,
  update_data bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, seq)
);
```

`seq` is server-assigned and monotonically increasing per project. It is the authoritative persisted ordering.

### 7.2 Update durability

Updates are appended or merged in a short per-project batch of approximately 25–100 ms. Each durable batch:

1. Enters the project's serialized persistence pipeline.
2. Locks the `canvas_yjs_documents` project row.
3. Computes `next_seq = durable_seq + 1`.
4. Inserts `(project_id, next_seq, update_data)`.
5. Advances `durable_seq`.
6. Commits.
7. Reports the batch as persisted.

Broadcast and durability are separate branches:

```text
Yjs update
  ├── broadcast to collaborators
  └── bounded persistence queue -> Neon -> durable acknowledgment
```

The UI must not report “Saved” before durable acknowledgment.

### 7.3 Hydration

After authorization and on first room activation:

1. Load the latest snapshot.
2. Load updates using:

```sql
SELECT update_data
FROM canvas_yjs_updates
WHERE project_id = $1
  AND seq > $2
ORDER BY seq ASC;
```

3. Apply updates after `snapshot_seq`.
4. Run schema migration if `schema_version` is old.
5. Create the active replica.
6. Sync clients using Yjs state vectors.

### 7.4 Snapshot and compaction

Snapshots are not created per mutation. Trigger compaction when any condition applies:

- No document changes for approximately five seconds.
- A periodic safety interval of approximately 30 seconds elapses.
- Update count or byte-size threshold is exceeded.
- An active room is about to unload.
- Hydration migrated an older document schema.

Write, compaction, migration, and unload are serialized per project. Snapshot encoding and persisted sequence-boundary capture occur in the same critical section, ensuring `snapshot_seq` never includes an update absent from the encoded snapshot.

Compaction transaction:

1. Acquire the project persistence/advisory lock.
2. Encode the active state at the exact persisted boundary.
3. Upsert snapshot, `snapshot_seq`, and `schema_version`.
4. Delete updates where `seq <= snapshot_seq`.
5. Commit atomically.

Updates above the captured boundary remain in the log.

## 8. Projection

An asynchronous worker projects authoritative Yjs state into:

- `canvas_nodes`
- `canvas_edges`
- Project scene metadata

Projection properties:

- Debounced approximately one to two seconds.
- Runs only after relevant Yjs updates become durable.
- Uses `projected_seq` for idempotent recovery.
- Advances `projected_seq` only in the same successful transaction as projected writes.
- Retries failures without interrupting collaboration.
- Never writes into Yjs.
- Exposes lag as `durable_seq - projected_seq` through logs/metrics.

Legacy APIs may read projection tables. They must not use them to hydrate an existing Yjs document.

## 9. Failure and Backpressure

Room persistence states:

```text
SYNCED       accepted by active replica
PERSISTING   queued for Neon
PERSISTED    committed to Neon
DEGRADED     persistence retry in progress
READ_ONLY    bounded queue capacity exhausted
```

On Neon failure:

1. Enter `DEGRADED`.
2. Retry with bounded exponential backoff and jitter.
3. Retain pending updates in a queue bounded by both update count and bytes.
4. Enter `READ_ONLY` when capacity is exhausted.
5. Keep cursor, presence, and selection active.
6. Reject or disable new document mutations without discarding queued updates.
7. Return to writable state after the queue flushes.

On projection failure, collaboration continues and projection resumes from `projected_seq`.

On `SIGTERM`, stop accepting new connections, flush pending writes, snapshot active rooms when time permits, and close gracefully. After a hard crash, reconstruct from snapshot plus updates after `snapshot_seq`.

## 10. Legacy Migration and Ownership

### Ownership

Existing projects using the placeholder UUID are migrated to the selected first/admin user ID from the main database. New projects use the authenticated main-app `userId`. Because databases are separate, this external user ID has no cross-database foreign key.

Every project list, read, mutation, token request, and WebSocket handshake must enforce ownership.

### One-time canvas import

For each legacy project:

1. Acquire the project lock.
2. If no persisted Yjs document exists, read legacy nodes, edges, and scene metadata once.
3. Construct a current-schema Y.Doc.
4. Persist the initial snapshot and metadata.
5. Commit the migration.
6. Never hydrate Yjs from legacy tables again.

Document existence and schema metadata make the process idempotent.

## 11. Testing Contract

Integration coverage must include:

- Invalid, expired, wrong-algorithm, wrong-issuer, and wrong-audience JWT rejection.
- Browser-supplied user identity cannot influence token issuance.
- Internal HMAC timestamp and replay rejection.
- A project A token cannot join project B.
- A non-owner is rejected before any sync state is sent.
- Independent concurrent node edits survive.
- Same-field concurrent edits converge.
- Delete-versus-edit converges.
- Reconnect uses state-vector sync rather than a whole-canvas upload.
- Snapshot plus ordered updates reconstructs identical state.
- Per-project sequence ordering remains correct under concurrency.
- Compaction never deletes updates absent from its snapshot.
- Schema migration persists a current-version snapshot.
- Projection restart resumes from `projected_seq`.
- Neon outage enters degraded/read-only state without unbounded memory.
- Awareness disappears after disconnect.
- Soft-lock expiry uses server-observed heartbeat.
- Legacy import occurs once and cannot overwrite later Yjs state.
- More than three participants can connect.

## 12. Explicit Non-goals for MVP

- Hard three-participant limits.
- Persistent presence, cursors, selections, or locks.
- Offline-first conflict UX beyond Yjs convergence and reconnect sync.
- Cross-account invitations or collaborator roles.
- Projection as a synchronous write path.
- PostgreSQL table inheritance or cross-database foreign keys.
