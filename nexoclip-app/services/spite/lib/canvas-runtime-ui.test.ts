import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getCanvasSaveIndicator,
  getCanvasRuntimeCapabilities,
  guardCanvasRuntimeControls,
} from './canvas-runtime-ui'

test('shows Saved only for durable PERSISTED status', () => {
  assert.equal(getCanvasSaveIndicator('PERSISTED').label, 'Saved')

  for (const status of ['SYNCED', 'PERSISTING', 'DEGRADED', 'READ_ONLY'] as const) {
    assert.notEqual(getCanvasSaveIndicator(status).label, 'Saved')
  }
})

test('uses distinct labels for pending, degraded, and read-only', () => {
  assert.equal(getCanvasSaveIndicator('SYNCED').label, 'Pending')
  assert.equal(getCanvasSaveIndicator('PERSISTING').label, 'Saving')
  assert.equal(getCanvasSaveIndicator('DEGRADED').label, 'Degraded')
  assert.equal(getCanvasSaveIndicator('READ_ONLY').label, 'Read-only')
})

test('read-only disables mutations but keeps presence enabled', () => {
  assert.deepEqual(getCanvasRuntimeCapabilities('READ_ONLY'), {
    allowDocumentMutation: false,
    allowPresence: true,
  })

  for (const status of ['SYNCED', 'PERSISTING', 'PERSISTED', 'DEGRADED'] as const) {
    assert.equal(getCanvasRuntimeCapabilities(status).allowDocumentMutation, true)
    assert.equal(getCanvasRuntimeCapabilities(status).allowPresence, true)
  }
})

test('read-only runtime controls no-op document commands but keep writable statuses live', () => {
  const calls: string[] = []
  const controls = {
    commands: {
      applyNodeChanges: (_changes?: unknown) => { calls.push('applyNodeChanges') },
      applyEdgeChanges: (_changes?: unknown) => { calls.push('applyEdgeChanges') },
      createNode: (_node?: unknown) => { calls.push('createNode') },
      patchNode: (_nodeId?: unknown, _patch?: unknown) => { calls.push('patchNode') },
      patchNodeData: (_nodeId?: unknown, _patch?: unknown) => { calls.push('patchNodeData') },
      updateNodeData: (_nodeId?: unknown, _updater?: unknown) => { calls.push('updateNodeData') },
      replaceShot: (_nodeId?: unknown, _shotId?: unknown) => { calls.push('replaceShot') },
      createNextShot: (_nodeId?: unknown) => { calls.push('createNextShot'); return 'shot-2' },
      deleteNode: (_nodeId?: unknown) => { calls.push('deleteNode') },
      createEdge: (_edge?: unknown) => { calls.push('createEdge') },
      deleteEdge: (_edgeId?: unknown) => { calls.push('deleteEdge') },
      duplicateNodes: (_nodeIds?: unknown) => { calls.push('duplicateNodes'); return ['copy-1'] },
      connect: (_connection?: unknown) => { calls.push('connect'); return 'edge-1' },
      createScene: (_name?: unknown) => { calls.push('createScene'); return 'scene-2' },
      deleteScene: (_sceneId?: unknown) => { calls.push('deleteScene') },
      switchScene: (_sceneId?: unknown) => { calls.push('switchScene') },
      batch: (callback: (commands: { createNode: (node?: unknown) => void }) => void) => {
        calls.push('batch')
        callback({ createNode: (_node?: unknown) => { calls.push('batch.createNode') } })
      },
    },
    undo: () => { calls.push('undo') },
    redo: () => { calls.push('redo') },
  } as any

  const readOnlyControls = guardCanvasRuntimeControls(controls, 'READ_ONLY')
  readOnlyControls.commands.createNode({})
  assert.deepEqual(readOnlyControls.commands.duplicateNodes(['node-1']), [])
  assert.equal(readOnlyControls.commands.createNextShot('node-1'), null)
  assert.equal(readOnlyControls.commands.connect({ source: 'a', sourceHandle: null, target: 'b', targetHandle: null }), null)
  assert.equal(readOnlyControls.commands.createScene('Scene 2'), 'scene-1')
  readOnlyControls.commands.batch(({ createNode }: { createNode: (node?: unknown) => void }) => createNode({}))
  readOnlyControls.undo()
  readOnlyControls.redo()
  assert.deepEqual(calls, [])

  const writableControls = guardCanvasRuntimeControls(controls, 'PERSISTED')
  writableControls.commands.createNode({})
  assert.deepEqual(writableControls.commands.duplicateNodes(['node-1']), ['copy-1'])
  assert.equal(writableControls.commands.createNextShot('node-1'), 'shot-2')
  assert.equal(writableControls.commands.connect({ source: 'a', sourceHandle: null, target: 'b', targetHandle: null }), 'edge-1')
  assert.equal(writableControls.commands.createScene('Scene 2'), 'scene-2')
  writableControls.commands.batch(({ createNode }: { createNode: (node?: unknown) => void }) => createNode({}))
  writableControls.undo()
  writableControls.redo()
  assert.deepEqual(calls, [
    'createNode',
    'duplicateNodes',
    'createNextShot',
    'connect',
    'createScene',
    'batch',
    'batch.createNode',
    'undo',
    'redo',
  ])
})
