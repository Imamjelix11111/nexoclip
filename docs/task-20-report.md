# Task 20 Report — Realtime CRDT Canvas Verification

## Canonical brief

Source: `docs/superpowers/plans/2026-09-08-spite-realtime-crdt-canvas.md` → **Task 20: End-to-End Collaboration and Recovery Verification**.

Required scope:
- verify multi-client collaboration convergence
- verify participant identity and presence cleanup
- verify reconnect JWT refresh
- verify hard-restart recovery from snapshot + tail updates
- verify projection catch-up to durable sequence
- verify bounded read-only degradation and recovery during persistence outage
- review projection/source boundaries and invariants
- run exact full verification before commit

## In-progress files inspected

Uncommitted integration / recovery / boundary work:
- `nexoclip-app/services/spite/realtime/collaboration.integration.test.ts`
- `nexoclip-app/services/spite/realtime/recover-projections.test.ts`
- `nexoclip-app/services/spite/realtime/recover-projections.ts`
- `nexoclip-app/services/spite/scripts/recover-realtime-projections.ts`
- `nexoclip-app/services/spite/lib/task-20-projection-boundary.test.ts`
- `nexoclip-app/services/spite/realtime/server.ts`
- `nexoclip-app/services/spite/package.json`
- `nexoclip-app/services/spite/README.md`
- `nexoclip-app/docs/production-runbook.md`

Supporting boundary files checked:
- `nexoclip-app/services/spite/realtime/projector.ts`
- `nexoclip-app/services/spite/realtime/yjs-repository.ts`
- `nexoclip-app/services/spite/app/api/projects/[projectId]/canvas/route.ts`
- `nexoclip-app/services/spite/app/api/projects/[projectId]/canvas/snapshots/route.ts`
- `nexoclip-app/services/spite/app/api/projects/[projectId]/duplicate/route.ts`
- `nexoclip-app/services/spite/lib/realtime/document.ts`

## Focused scenario verification

Executed:

```bash
cd nexoclip-app/services/spite
rtk ./node_modules/.bin/tsx --test realtime/collaboration.integration.test.ts realtime/recover-projections.test.ts lib/task-20-projection-boundary.test.ts
```

Result: **8/8 passing**

Covered scenarios:
- 5 concurrent clients converge on different-node edits
- same-field concurrent edits converge deterministically
- delete/edit race converges to delete
- same-user multi-tab presence gets separate guest identities
- disconnect cleanup removes stale presence
- provider async JWT callback runs again on reconnect
- hard restart rehydrates from snapshot + updates and reprojects to durable seq
- persistence outage degrades to bounded read-only, then recovers to persisted writable sync
- recovery utility reprojects lagging documents and skips already-caught-up documents
- projection compatibility tables are only mutated at projector / cleanup boundaries

## Boundary audit

Searches run against `app/`, `lib/`, `realtime/`, and `scripts/` confirmed:
- direct `canvas_nodes` / `canvas_edges` writes are confined to `realtime/projector.ts` plus deletion cleanup boundaries already allowlisted in the boundary test
- `projects.scenes` and `active_scene_id` are written by the projector compatibility path and read/imported by repository / compatibility endpoints
- legacy canvas POST remains `410 Gone` and does not restore authoritative state
- snapshot restore and duplicate routes go through trusted internal realtime document export/replace instead of direct projection rewrites
- authoritative state remains Yjs-backed; compatibility reads remain projection-backed
- no active client REST whole-array autosave path remains in service code

Re-checked invariants:
1. persisted Yjs document is authoritative
2. React Flow payload is derived from Yjs projection
3. legacy SQL tables are projection-only compatibility storage
4. ACK is sent only after durable enqueue/commit completes
5. authorization happens before room access / hydration

## Exact full verification

### Root app

```bash
cd nexoclip-app
rtk node --test tests/realtime/*.test.mjs tests/deployment/dockerDeployment.test.mjs tests/production/productionConfig.test.mjs tests/api/jobsBuildSafety.test.mjs
```

Result: **34/34 passing**

```bash
cd nexoclip-app
rtk npm run build
```

Result: **pass**

Observed non-blocking warning:
- optional BullMQ `@valkey/valkey-glide` resolution warning during Next build

### Spite service

```bash
cd nexoclip-app/services/spite
rtk npm test
```

Result: **82/82 passing**

```bash
cd nexoclip-app/services/spite
rtk npm exec tsc -- --noEmit
```

Result: **pass**

```bash
cd nexoclip-app/services/spite
rtk npm run build
```

Result: **pass**

Observed non-blocking warnings:
- Next inferred workspace root because multiple lockfiles exist
- Next warns `middleware` convention is deprecated in favor of `proxy`
- `tsx` realtime/provider tests emit expected `localStorage` experimental warning
- root node tests emit existing `MODULE_TYPELESS_PACKAGE_JSON` warnings for ESM `.js` files

## Outcome

Task 20 verification work is complete. No blocking failures remained after focused and full verification.
