import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'

import { createCanvasDocument, readCanvasProjection, upsertNode } from '../lib/realtime/document'
import { recoverProjectionLag } from './recover-projections'

test('recoverProjectionLag reprojects every lagging project to its current durable boundary', async () => {
  const doc = createCanvasDocument()
  upsertNode(doc, {
    id: 'node-1',
    type: 'prompt',
    position: { x: 10, y: 20 },
    data: { label: 'hello' },
  })

  const projectorCalls: Array<{ projectId: string; targetSeq: number; projection: ReturnType<typeof readCanvasProjection> }> = []

  const result = await recoverProjectionLag({
    repository: {
      async loadProjectionLag() {
        return [{ projectId: 'project-1', durableSeq: 7, projectedSeq: 3, lag: 4 }]
      },
      async loadOrImport() {
        return {
          doc,
          snapshotSeq: 5,
          durableSeq: 7,
          projectedSeq: 3,
        }
      },
      async close() {},
    },
    projector: async (projectId, projection, targetSeq) => {
      projectorCalls.push({ projectId, targetSeq, projection })
    },
  })

  assert.deepEqual(result, {
    scanned: 1,
    recovered: 1,
    skipped: 0,
  })
  assert.deepEqual(projectorCalls, [{
    projectId: 'project-1',
    targetSeq: 7,
    projection: readCanvasProjection(doc),
  }])
})

test('recoverProjectionLag skips projects that are already caught up when reloaded', async () => {
  const doc = createCanvasDocument()
  upsertNode(doc, {
    id: 'node-1',
    type: 'prompt',
    position: { x: 1, y: 2 },
    data: { label: 'steady' },
  })

  let projectorCalled = false
  const result = await recoverProjectionLag({
    repository: {
      async loadProjectionLag() {
        return [{ projectId: 'project-1', durableSeq: 4, projectedSeq: 1, lag: 3 }]
      },
      async loadOrImport() {
        return {
          doc,
          snapshotSeq: 4,
          durableSeq: 4,
          projectedSeq: 4,
        }
      },
      async close() {},
    },
    projector: async () => {
      projectorCalled = true
    },
  })

  assert.deepEqual(result, {
    scanned: 1,
    recovered: 0,
    skipped: 1,
  })
  assert.equal(projectorCalled, false)
})
