# Spite Local Realtime Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the CRDT canvas to a configured realtime server and issue authenticated project-scoped WebSocket tokens.

**Architecture:** The client reads a public absolute WebSocket URL only when configured, falling back to the existing same-origin proxy URL. A dedicated App Router token handler authenticates the request, checks project ownership in Postgres, and signs the existing 60-second JWT format.

**Tech Stack:** Next.js 16 App Router, TypeScript, node:test, Yjs/Hocuspocus, `jose`, Neon Postgres.

## Global Constraints

- Preserve same-origin `/spite/ws` fallback when `NEXT_PUBLIC_REALTIME_URL` is absent.
- Never accept a browser-provided user ID.
- Tokens use `REALTIME_TOKEN_SECRET` and `issueRealtimeToken`.
- Return 401 unauthenticated, 404 foreign/missing project, 400 invalid JSON/body, and 500 missing server configuration.
- Do not expose secrets in responses or logs.

---

### Task 1: Configurable client WebSocket URL

**Files:**
- Modify: `nexoclip-app/services/spite/hooks/use-realtime-canvas.ts`
- Modify: `nexoclip-app/services/spite/lib/realtime/react-flow-binding.test.ts`

**Interfaces:**
- Produces: `resolveRealtimeWebsocketUrl(locationLike?): string`
- Consumes: `process.env.NEXT_PUBLIC_REALTIME_URL`

- [ ] **Step 1: Write failing tests**

```ts
test('resolveRealtimeWebsocketUrl prefers configured public realtime URL', () => {
  const previous = process.env.NEXT_PUBLIC_REALTIME_URL
  process.env.NEXT_PUBLIC_REALTIME_URL = 'ws://127.0.0.1:3008'
  assert.equal(resolveRealtimeWebsocketUrl(new URL('http://localhost:3101/spite')), 'ws://127.0.0.1:3008/')
  process.env.NEXT_PUBLIC_REALTIME_URL = previous
})
```

Add a second test asserting an empty config preserves `ws://localhost:3101/spite/ws`.

- [ ] **Step 2: Run the focused test**

Run: `rtk npm test -- --test-name-pattern='resolveRealtimeWebsocketUrl'`

Expected: configured URL assertion fails because the function currently always derives `/spite/ws`.

- [ ] **Step 3: Implement resolution**

```ts
const configuredUrl = process.env.NEXT_PUBLIC_REALTIME_URL?.trim()
if (configuredUrl) return new URL(configuredUrl).toString()
```

Keep existing same-origin URL construction as the fallback. Invalid configured URLs must fall back rather than crash initial render.

- [ ] **Step 4: Run focused and full tests**

Run: `rtk npm test && rtk npm run test:realtime`

Expected: PASS.

### Task 2: Authenticated realtime-token route

**Files:**
- Create: `nexoclip-app/services/spite/app/api/auth/realtime-token/route.ts`
- Create: `nexoclip-app/services/spite/lib/realtime-token-route.test.ts`

**Interfaces:**
- Produces: `createRealtimeTokenHandler(deps?)` returning `POST(request): Promise<Response>`
- Consumes: `getAuthenticatedUser`, `getDb`, `userOwnsProject`, `issueRealtimeToken`, `process.env.REALTIME_TOKEN_SECRET`
- Response: `{ token: string, expiresAt: number }`

- [ ] **Step 1: Write failing handler tests**

```ts
test('issues a project-bound token only for the authenticated owner', async () => {
  const POST = createRealtimeTokenHandler({
    getAuthenticatedUser: async () => ({ id: OWNER_ID }),
    getDb: () => fakeSql as any,
    userOwnsProject: async () => true,
    issueRealtimeToken: async ({ userId, projectId }) => ({ token: `${userId}:${projectId}`, expiresAt: 123 }),
    env: { REALTIME_TOKEN_SECRET: 'secret' },
  })
  const response = await POST(new Request('http://localhost/api/auth/realtime-token', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: PROJECT_ID }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { token: `${OWNER_ID}:${PROJECT_ID}`, expiresAt: 123 })
})
```

Add tests for unauthenticated (401), foreign project (404), malformed/missing projectId (400), and missing secret (500 without secret text).

- [ ] **Step 2: Run the new test file**

Run: `rtk npm test -- lib/realtime-token-route.test.ts`

Expected: FAIL because the route module does not exist.

- [ ] **Step 3: Implement the minimal route**

Parse JSON defensively; require a non-empty string `projectId`. Resolve the user from `getAuthenticatedUser(request)`, call `userOwnsProject(db(), user.id, projectId)`, and only then call `issueRealtimeToken({ userId: user.id, projectId }, secret)`. Export a dependency-injectable factory and wire its default as `POST`.

- [ ] **Step 4: Run all validation**

Run: `rtk npm test && rtk npm run test:realtime && rtk npm run build`

Expected: PASS.

### Task 3: Local runtime verification

**Files:**
- No repository changes.

- [ ] **Step 1: Restart local servers with matching configuration**

Run Next with `PORT=3101 NEXT_PUBLIC_REALTIME_URL=ws://127.0.0.1:3008` and realtime with `.env.local` loaded plus `PORT=3008`.

- [ ] **Step 2: Verify endpoints and connections**

Confirm `http://127.0.0.1:3101/login` returns 200, port 3008 listens, and authenticated browser canvas obtains `/api/auth/realtime-token` 200 before the WebSocket opens.

- [ ] **Step 3: Verify behavior manually**

Open the same project in two browser tabs. Create/move a node in one tab and confirm it appears in the other; confirm save state reaches `Saved`.
