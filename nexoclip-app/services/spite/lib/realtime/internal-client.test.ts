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
