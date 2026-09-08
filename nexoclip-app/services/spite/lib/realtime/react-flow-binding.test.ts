import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'

import {
  createCanvasDocument,
  readCanvasProjection,
  setActiveSceneId,
  setScenes,
  upsertEdge,
  upsertNode,
} from './document'
import { LOCAL_REACT_FLOW_ORIGIN, createReactFlowBinding } from './react-flow-binding'
import {
  getOrCreateRealtimeCanvasRoom,
  releaseRealtimeCanvasRoom,
} from '../../hooks/use-realtime-canvas'

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'

class FakeAwareness {
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly states = new Map<number, Record<string, unknown>>()

  on(event: 'change' | 'update', listener: () => void): void {
    const listeners = this.listeners.get(event) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  off(event: 'change' | 'update', listener: () => void): void {
    this.listeners.get(event)?.delete(listener)
  }

  getStates(): Map<number, Record<string, unknown>> {
    return new Map(this.states)
  }

  setState(clientId: number, state: Record<string, unknown>): void {
    this.states.set(clientId, state)
    this.emit('change')
    this.emit('update')
  }

  destroy(): void {
    this.listeners.clear()
    this.states.clear()
  }

  private emit(event: 'change' | 'update'): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener()
    }
  }
}

class FakeProvider {
  readonly awareness = new FakeAwareness()
  readonly document: Y.Doc
  readonly token: string | (() => Promise<string>) | null
  readonly onStateless: (event: { payload: string }) => void
  destroyed = false

  constructor(configuration: {
    document: Y.Doc
    token: string | (() => Promise<string>) | null
    onStateless: (event: { payload: string }) => void
  }) {
    this.document = configuration.document
    this.token = configuration.token
    this.onStateless = configuration.onStateless
  }

  emitStateless(payload: string): void {
    this.onStateless({ payload })
  }

  destroy(): void {
    this.destroyed = true
    this.awareness.destroy()
  }
}

function findNode(projection: ReturnType<typeof readCanvasProjection>, nodeId: string) {
  const node = projection.nodes.find((candidate) => candidate.id === nodeId)
  assert.ok(node, `expected node ${nodeId} to exist`)
  return node
}

function captureUpdate(doc: Y.Doc, mutate: () => void): Uint8Array {
  let captured: Uint8Array | null = null
  const handleUpdate = (update: Uint8Array) => {
    captured = new Uint8Array(update)
  }

  doc.on('update', handleUpdate)
  mutate()
  doc.off('update', handleUpdate)

  assert.ok(captured, 'expected mutation to emit a Yjs update')
  return captured
}

test('binding writes local React Flow changes into Yjs while retaining hidden-scene state', () => {
  const doc = createCanvasDocument()
  setScenes(doc, [
    { id: 'scene-1', name: 'Scene 1' },
    { id: 'scene-2', name: 'Scene 2' },
  ])
  setActiveSceneId(doc, 'scene-1')

  upsertNode(doc, {
    id: 'node-1',
    type: 'prompt',
    position: { x: 10, y: 20 },
    data: { sceneId: 'scene-1', label: 'Visible' },
  })
  upsertNode(doc, {
    id: 'node-2',
    type: 'prompt',
    position: { x: 30, y: 40 },
    data: { sceneId: 'scene-2', label: 'Hidden' },
  })
  upsertEdge(doc, {
    id: 'edge-hidden',
    source: 'node-2',
    target: 'node-2',
    data: { label: 'retained' },
  })

  const binding = createReactFlowBinding(doc)
  const initialSnapshot = binding.getSnapshot()
  const snapshots = [initialSnapshot]
  const unsubscribe = binding.subscribe(() => {
    snapshots.push(binding.getSnapshot())
  })

  binding.createNode({
    id: 'node-3',
    type: 'comment',
    position: { x: 50, y: 60 },
    selected: true,
    dragging: true,
    measured: { width: 120, height: 80 },
    data: { sceneId: 'scene-1', label: 'New node' },
  } as any)
  binding.applyNodeChanges([
    {
      type: 'position',
      id: 'node-1',
      position: { x: 70, y: 80 },
      dragging: true,
    },
  ] as any)

  const projection = readCanvasProjection(doc)
  assert.equal(findNode(projection, 'node-1').position.x, 70)
  assert.equal(findNode(projection, 'node-1').position.y, 80)
  assert.ok(projection.nodes.some((node) => node.id === 'node-2'))
  assert.ok(projection.edges.some((edge) => edge.id === 'edge-hidden'))

  const rawNode = doc.getMap<Y.Map<unknown>>('nodes').get('node-3')
  assert.ok(rawNode instanceof Y.Map)
  assert.equal(rawNode.get('selected'), undefined)
  assert.equal(rawNode.get('dragging'), undefined)
  assert.equal(rawNode.get('measured'), undefined)

  const latestSnapshot = binding.getSnapshot()
  assert.deepEqual(
    latestSnapshot.nodes.map((node) => node.id).sort(),
    ['node-1', 'node-3'],
  )
  assert.deepEqual(latestSnapshot.edges, [])
  assert.notEqual(latestSnapshot.nodes, snapshots[0].nodes)

  unsubscribe()
  binding.destroy()
})

test('binding observers publish remote updates without writing them back', () => {
  const doc = createCanvasDocument()
  const binding = createReactFlowBinding(doc)
  const origins: Array<string | object | null | undefined> = []
  const snapshots: ReturnType<typeof binding.getSnapshot>[] = []

  doc.on('afterTransaction', (transaction) => {
    origins.push(transaction.origin)
  })

  const unsubscribe = binding.subscribe(() => {
    snapshots.push(binding.getSnapshot())
  })

  const remoteReplica = new Y.Doc()
  Y.applyUpdate(remoteReplica, Y.encodeStateAsUpdate(doc))
  const remoteUpdate = captureUpdate(remoteReplica, () => {
    upsertNode(remoteReplica, {
      id: 'remote-node',
      type: 'prompt',
      position: { x: 11, y: 22 },
      data: { sceneId: 'scene-1', label: 'Remote' },
    })
  })

  Y.applyUpdate(doc, remoteUpdate, 'remote-sync')

  const latestSnapshot = binding.getSnapshot()
  assert.equal(latestSnapshot.nodes.length, 1)
  assert.equal(latestSnapshot.nodes[0].id, 'remote-node')
  assert.deepEqual(origins, ['remote-sync'])
  assert.equal(snapshots.length, 1)

  unsubscribe()
  binding.destroy()
})

test('undo manager tracks only local binding origin', () => {
  const doc = createCanvasDocument()
  const binding = createReactFlowBinding(doc)

  binding.createNode({
    id: 'local-node',
    type: 'prompt',
    position: { x: 1, y: 2 },
    data: { sceneId: 'scene-1', label: 'Local' },
  })

  const remoteReplica = new Y.Doc()
  Y.applyUpdate(remoteReplica, Y.encodeStateAsUpdate(doc))
  const remoteUpdate = captureUpdate(remoteReplica, () => {
    upsertNode(remoteReplica, {
      id: 'remote-node',
      type: 'prompt',
      position: { x: 3, y: 4 },
      data: { sceneId: 'scene-1', label: 'Remote' },
    })
  })

  Y.applyUpdate(doc, remoteUpdate, 'remote-sync')

  binding.undo()
  let projection = readCanvasProjection(doc)
  assert.equal(projection.nodes.some((node) => node.id === 'local-node'), false)
  assert.equal(projection.nodes.some((node) => node.id === 'remote-node'), true)

  binding.redo()
  projection = readCanvasProjection(doc)
  assert.equal(projection.nodes.some((node) => node.id === 'local-node'), true)
  assert.equal(projection.nodes.some((node) => node.id === 'remote-node'), true)

  binding.destroy()
})

test('realtime room caches one doc/provider per project, refreshes tokens, and parses durable status messages', async () => {
  const fetchCalls: Array<{ input: string; init: RequestInit | undefined }> = []
  const createdProviders: FakeProvider[] = []

  const roomA = getOrCreateRealtimeCanvasRoom(PROJECT_ID, {
    websocketUrl: 'ws://127.0.0.1:3000/spite/ws',
    fetchFn: async (input, init) => {
      fetchCalls.push({ input: String(input), init })
      return new Response(JSON.stringify({ token: 'realtime-token', expiresAt: 123 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
    createProvider: (configuration) => {
      const provider = new FakeProvider(configuration as any)
      createdProviders.push(provider)
      return provider as any
    },
  })
  const roomB = getOrCreateRealtimeCanvasRoom(PROJECT_ID, {
    websocketUrl: 'ws://127.0.0.1:3000/spite/ws',
    fetchFn: async () => {
      throw new Error('cached room should reuse the original fetcher')
    },
    createProvider: () => {
      throw new Error('cached room should reuse the original provider')
    },
  })

  assert.equal(roomA, roomB)
  assert.equal(createdProviders.length, 1)

  const tokenOne = await roomA.getToken()
  const tokenTwo = await roomA.getToken()
  assert.equal(tokenOne, 'realtime-token')
  assert.equal(tokenTwo, 'realtime-token')
  assert.deepEqual(
    fetchCalls.map((call) => call.input),
    ['/api/auth/realtime-token', '/api/auth/realtime-token'],
  )
  assert.deepEqual(
    fetchCalls.map((call) => call.init?.method),
    ['POST', 'POST'],
  )

  createdProviders[0].emitStateless(
    JSON.stringify({ type: 'STATUS', projectId: PROJECT_ID, status: 'DEGRADED' }),
  )
  assert.equal(roomA.getSnapshot().persistenceStatus, 'DEGRADED')

  createdProviders[0].emitStateless(
    JSON.stringify({ type: 'ACK', projectId: PROJECT_ID, status: 'PERSISTED', seq: 7 }),
  )
  assert.equal(roomA.getSnapshot().persistenceStatus, 'PERSISTED')

  roomA.retain()
  roomB.retain()
  releaseRealtimeCanvasRoom(PROJECT_ID)
  assert.equal(createdProviders[0].destroyed, false)
  releaseRealtimeCanvasRoom(PROJECT_ID)
  assert.equal(createdProviders[0].destroyed, true)
}
)