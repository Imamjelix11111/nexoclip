import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'

import {
  CURRENT_SCHEMA_VERSION,
  createCanvasDocument,
  deleteEdge,
  deleteNode,
  importLegacyCanvas,
  migrateCanvasDocument,
  parseProjectDocumentName,
  patchNode,
  readCanvasProjection,
  setActiveSceneId,
  setProjectName,
  setScenes,
  upsertEdge,
  upsertNode,
} from './document'

test('createCanvasDocument initializes canonical top-level maps and schema version', () => {
  const doc = createCanvasDocument()

  assert.ok(doc.getMap('nodes') instanceof Y.Map)
  assert.ok(doc.getMap('edges') instanceof Y.Map)
  assert.ok(doc.getMap('meta') instanceof Y.Map)
  assert.equal(doc.getMap('meta').get('schemaVersion'), CURRENT_SCHEMA_VERSION)
})

test('parseProjectDocumentName accepts project:<uuid> and returns project id', () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000'
  assert.equal(parseProjectDocumentName(`project:${projectId}`), projectId)

  assert.throws(() => parseProjectDocumentName(projectId), /Invalid project document name/)
  assert.throws(() => parseProjectDocumentName('project:not-a-uuid'), /Invalid project document name/)
})

test('upsert operations store nodes and edges as nested Y.Map with granular positions', () => {
  const doc = createCanvasDocument()

  upsertNode(doc, {
    id: 'node-1',
    type: 'prompt',
    position: { x: 120, y: 48 },
    selected: true,
    dragging: true,
    measured: { width: 140, height: 80 },
    data: { text: 'hello' },
  })

  upsertEdge(doc, {
    id: 'edge-1',
    source: 'node-1',
    target: 'node-2',
    selected: true,
    animated: true,
    data: { label: 'flow' },
  })

  const rawNode = doc.getMap('nodes').get('node-1')
  const rawEdge = doc.getMap('edges').get('edge-1')

  assert.ok(rawNode instanceof Y.Map)
  assert.ok(rawEdge instanceof Y.Map)

  assert.equal((rawNode as Y.Map<unknown>).get('positionX'), 120)
  assert.equal((rawNode as Y.Map<unknown>).get('positionY'), 48)
  assert.equal((rawNode as Y.Map<unknown>).get('selected'), undefined)
  assert.equal((rawNode as Y.Map<unknown>).get('dragging'), undefined)
  assert.equal((rawNode as Y.Map<unknown>).get('measured'), undefined)

  assert.equal((rawEdge as Y.Map<unknown>).get('selected'), undefined)
})

test('deleteEdge removes edge entry', () => {
  const doc = createCanvasDocument()

  upsertEdge(doc, {
    id: 'edge-1',
    source: 'node-1',
    target: 'node-2',
    data: { label: 'flow' },
  })
  deleteEdge(doc, 'edge-1')

  assert.equal(doc.getMap('edges').get('edge-1'), undefined)
})

test('importLegacyCanvas round-trips to projection and keeps scene metadata', () => {
  const doc = createCanvasDocument()

  importLegacyCanvas(doc, {
    nodes: [
      {
        id: 'node-1',
        type: 'image',
        position: { x: 16, y: 24 },
        data: { sceneId: 'scene-2' },
        selected: true,
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        selected: true,
      },
    ],
    scenes: [
      { id: 'scene-1', name: 'Scene 1' },
      { id: 'scene-2', name: 'Scene 2' },
    ],
    activeSceneId: 'scene-2',
  })

  const projection = readCanvasProjection(doc)
  assert.deepEqual(projection.nodes, [
    {
      id: 'node-1',
      type: 'image',
      position: { x: 16, y: 24 },
      data: { sceneId: 'scene-2' },
    },
  ])
  assert.deepEqual(projection.edges, [
    {
      id: 'edge-1',
      source: 'node-1',
      target: 'node-2',
      data: {},
    },
  ])
  assert.deepEqual(projection.scenes, [
    { id: 'scene-1', name: 'Scene 1' },
    { id: 'scene-2', name: 'Scene 2' },
  ])
  assert.equal(projection.activeSceneId, 'scene-2')
})

test('project name is durable canvas metadata', () => {
  const doc = createCanvasDocument()

  setProjectName(doc, 'Realtime project')

  assert.equal(readCanvasProjection(doc).projectName, 'Realtime project')
})

test('scene metadata commands update projection meta', () => {
  const doc = createCanvasDocument()

  setScenes(doc, [
    { id: 'scene-a', name: 'A' },
    { id: 'scene-b', name: 'B' },
  ])
  setActiveSceneId(doc, 'scene-b')

  const projection = readCanvasProjection(doc)
  assert.deepEqual(projection.scenes, [
    { id: 'scene-a', name: 'A' },
    { id: 'scene-b', name: 'B' },
  ])
  assert.equal(projection.activeSceneId, 'scene-b')
})

test('setScenes keeps activeSceneId valid with deterministic fallback', () => {
  const doc = createCanvasDocument()

  setScenes(doc, [
    { id: 'scene-a', name: 'A' },
    { id: 'scene-b', name: 'B' },
  ])
  setActiveSceneId(doc, 'scene-b')

  setScenes(doc, [
    { id: 'scene-c', name: 'C' },
    { id: 'scene-d', name: 'D' },
  ])

  const projection = readCanvasProjection(doc)
  assert.deepEqual(projection.scenes, [
    { id: 'scene-c', name: 'C' },
    { id: 'scene-d', name: 'D' },
  ])
  assert.equal(projection.activeSceneId, 'scene-c')
})

test('migrateCanvasDocument normalizes schema and active scene fallback', () => {
  const doc = new Y.Doc()
  const meta = doc.getMap('meta')
  meta.set('schemaVersion', 0)
  meta.set('scenes', [{ id: 'scene-z', name: 'Z' }])
  meta.set('activeSceneId', 'missing-scene')

  const changed = migrateCanvasDocument(doc, 0)
  assert.equal(changed, true)

  const projection = readCanvasProjection(doc)
  assert.equal(doc.getMap('meta').get('schemaVersion'), CURRENT_SCHEMA_VERSION)
  assert.deepEqual(projection.scenes, [{ id: 'scene-z', name: 'Z' }])
  assert.equal(projection.activeSceneId, 'scene-z')
})

test('migrateCanvasDocument is a no-op for current schema', () => {
  const doc = createCanvasDocument()

  const changed = migrateCanvasDocument(doc, CURRENT_SCHEMA_VERSION)

  assert.equal(changed, false)
})

test('independent concurrent edits converge with both changes preserved', () => {
  const seed = createCanvasDocument()
  upsertNode(seed, {
    id: 'node-1',
    type: 'prompt',
    position: { x: 10, y: 20 },
    data: { label: 'before' },
  })

  const docA = new Y.Doc()
  const docB = new Y.Doc()
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(seed))
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(seed))

  patchNode(docA, 'node-1', { position: { x: 111, y: 20 } })
  patchNode(docB, 'node-1', { type: 'image' })

  const updateA = Y.encodeStateAsUpdate(docA)
  const updateB = Y.encodeStateAsUpdate(docB)
  Y.applyUpdate(docA, updateB)
  Y.applyUpdate(docB, updateA)

  const nodeA = readCanvasProjection(docA).nodes[0]
  const nodeB = readCanvasProjection(docB).nodes[0]

  assert.equal(nodeA.type, 'image')
  assert.equal(nodeA.position.x, 111)
  assert.deepEqual(nodeA, nodeB)
})

test('concurrent same-field edits converge deterministically to one value', () => {
  const seed = createCanvasDocument()
  upsertNode(seed, {
    id: 'node-1',
    type: 'prompt',
    position: { x: 10, y: 20 },
    data: {},
  })

  const docA = new Y.Doc()
  const docB = new Y.Doc()
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(seed))
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(seed))

  patchNode(docA, 'node-1', { type: 'image' })
  patchNode(docB, 'node-1', { type: 'video' })

  const updateA = Y.encodeStateAsUpdate(docA)
  const updateB = Y.encodeStateAsUpdate(docB)
  Y.applyUpdate(docA, updateB)
  Y.applyUpdate(docB, updateA)

  const typeA = readCanvasProjection(docA).nodes[0].type
  const typeB = readCanvasProjection(docB).nodes[0].type

  assert.equal(typeA, typeB)
  assert.ok(typeA === 'image' || typeA === 'video')
})

test('delete-versus-edit concurrent race converges across replicas', () => {
  const seed = createCanvasDocument()
  upsertNode(seed, {
    id: 'node-1',
    type: 'prompt',
    position: { x: 10, y: 20 },
    data: { value: 1 },
  })

  const docA = new Y.Doc()
  const docB = new Y.Doc()
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(seed))
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(seed))

  deleteNode(docA, 'node-1')
  patchNode(docB, 'node-1', { data: { value: 2 } })

  const updateA = Y.encodeStateAsUpdate(docA)
  const updateB = Y.encodeStateAsUpdate(docB)
  Y.applyUpdate(docA, updateB)
  Y.applyUpdate(docB, updateA)

  const nodesA = readCanvasProjection(docA).nodes
  const nodesB = readCanvasProjection(docB).nodes

  assert.deepEqual(nodesA, nodesB)
  assert.deepEqual(nodesA, [])
})
