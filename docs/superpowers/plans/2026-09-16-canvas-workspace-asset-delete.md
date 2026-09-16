# Canvas Workspace Asset Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Canvas workspace asset deletion secure and functional across Spite, PostgreSQL, and object storage.

**Architecture:** Spite validates the active Canvas before proxying deletion to a workspace-scoped main-app endpoint. The main app deletes the object and metadata; Spite removes folder links and the UI refreshes existing SWR state.

**Tech Stack:** Next.js App Router, Node.js, PostgreSQL, R2/S3, React, SWR.

## Global Constraints

- Protect assets currently referenced by the active Canvas.
- Verify project and workspace ownership server-side.
- Add no dependencies or migrations.
- Use TDD and preserve existing legacy asset deletion.

---

### Task 1: Workspace asset deletion service and endpoint

**Files:**
- Modify: `nexoclip-app/src/services/assetService.js`
- Modify: `nexoclip-app/src/storage/r2ObjectStorage.js`
- Modify: `nexoclip-app/src/storage/localObjectStorage.js`
- Create: `nexoclip-app/app/api/assets/[assetId]/route.js`
- Test: `nexoclip-app/tests/assets/assetService.test.mjs`
- Test: `nexoclip-app/tests/assets/assetDeleteRoute.test.mjs`

**Interfaces:**
- Produces: `deleteWorkspaceAsset(workspaceId, assetId, storage, pool)` returning the deleted asset or `null`.

- [ ] Write tests proving workspace scoping, object deletion, 401, 404, and success.
- [ ] Run tests and verify expected failures because deletion is absent.
- [ ] Add storage `delete(key)`, deletion service, and authenticated `DELETE` route.
- [ ] Run tests and verify they pass.

### Task 2: Spite protection and proxy

**Files:**
- Modify: `nexoclip-app/services/spite/app/api/assets/[assetId]/route.ts`
- Test: `nexoclip-app/services/spite/app/api/assets/[assetId]/route.test.ts`

**Interfaces:**
- Consumes: main-app `DELETE /api/assets/:assetId`.

- [ ] Write tests for active-Canvas protection and authenticated workspace proxying.
- [ ] Run tests and verify expected failures.
- [ ] Add project ownership validation, realtime-reference check, proxy, and folder-link cleanup for workspace assets.
- [ ] Run tests and verify they pass.

### Task 3: UI request and verification

**Files:**
- Modify: `nexoclip-app/services/spite/components/canvas/left-toolbar.tsx`
- Test: `nexoclip-app/services/spite/lib/workspace-asset-delete.test.ts`

**Interfaces:**
- Sends: `DELETE /spite/api/assets/:assetId?projectId=:projectId`.

- [ ] Write a regression test requiring every Assets-panel delete request to carry `projectId`.
- [ ] Run it and verify failure.
- [ ] Update single and bulk deletion requests.
- [ ] Run focused tests, full Spite tests, provider/app tests, and production build.
- [ ] Commit, merge, push all remotes, and verify Railway deployments.
