import assert from 'node:assert/strict'
import test from 'node:test'

import {
  InternalRealtimeRequestError,
  createInternalRealtimeClient,
} from './internal-client'

const BASE_ENV = {
  CANVAS_AUTH_URL: 'http://realtime.local/internal/authorize',
  CANVAS_AUTH_HMAC_SECRET: 'canvas-secret',
}

test('replaceDocument preserves projection payload and tags projection source in body and header', async () => {
  let capturedRequest: { headers: HeadersInit | undefined; body: Record<string, unknown> } | null = null
  const projection = {
    nodes: [{ id: 'node-1', type: 'prompt', position: { x: 12, y: 24 }, data: { label: 'hello' } }],
    edges: [],
    scenes: [{ id: 'scene-1', name: 'Scene 1' }],
    activeSceneId: 'scene-1',
  }

  const client = createInternalRealtimeClient({
    env: BASE_ENV,
    now: () => 1_700_000_000,
    createNonce: () => 'nonce-123',
    fetchFn: async (_input, init) => {
      capturedRequest = {
        headers: init?.headers,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      }
      return Response.json({ ok: true })
    },
  })

  await client.replaceDocument({
    userId: 'user-1',
    projectId: 'project-1',
    projection,
  })

  if (!capturedRequest) {
    throw new Error('expected captured request')
  }

  const request = capturedRequest as { headers: HeadersInit | undefined; body: Record<string, unknown> }
  assert.deepEqual(request.headers, {
    'content-type': 'application/json',
    'X-Canvas-Source': 'projection',
  })
  assert.equal(request.body.action, 'replace-document')
  assert.equal(request.body.userId, 'user-1')
  assert.equal(request.body.projectId, 'project-1')
  assert.equal(request.body.source, 'projection')
  assert.deepEqual(request.body.projection, projection)
})

test('internal realtime client maps validation, read-only conflicts, service unavailability, and backend failures', async () => {
  const responses = [
    Response.json({ error: 'projection is required' }, { status: 400 }),
    Response.json({ error: 'Project room runtime is read-only' }, { status: 409 }),
    Response.json({ error: 'server shutting down' }, { status: 503 }),
    Response.json({ error: 'database offline' }, { status: 500 }),
  ]

  const client = createInternalRealtimeClient({
    env: BASE_ENV,
    now: () => 1_700_000_000,
    createNonce: () => 'nonce-123',
    fetchFn: async () => {
      const response = responses.shift()
      assert.ok(response, 'expected stubbed response')
      return response
    },
  })

  await assert.rejects(
    client.replaceDocument({
      userId: 'user-1',
      projectId: 'project-1',
      projection: {
        nodes: [],
        edges: [],
        scenes: [{ id: 'scene-1', name: 'Scene 1' }],
        activeSceneId: 'scene-1',
      },
    }),
    (error: unknown) => error instanceof InternalRealtimeRequestError
      && error.status === 400
      && error.message === 'Realtime internal request validation failed: projection is required',
  )

  await assert.rejects(
    client.patchNodeData({
      userId: 'user-1',
      projectId: 'project-1',
      nodeId: 'node-1',
      set: { status: 'completed' },
    }),
    (error: unknown) => error instanceof InternalRealtimeRequestError
      && error.status === 409
      && error.message === 'Realtime internal request conflicted with read-only state: Project room runtime is read-only',
  )

  await assert.rejects(
    client.exportDocument({
      userId: 'user-1',
      projectId: 'project-1',
    }),
    (error: unknown) => error instanceof InternalRealtimeRequestError
      && error.status === 503
      && error.message === 'Realtime internal request unavailable: server shutting down',
  )

  await assert.rejects(
    client.exportDocument({
      userId: 'user-1',
      projectId: 'project-1',
    }),
    (error: unknown) => error instanceof InternalRealtimeRequestError
      && error.status === 500
      && error.message === 'Realtime internal request failed with 500: database offline',
  )
})
