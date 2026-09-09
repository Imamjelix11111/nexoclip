import assert from 'node:assert/strict'
import test from 'node:test'

import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'

import {
  createCanvasDocument,
  deleteNode,
  patchNode,
  readCanvasProjection,
  upsertNode,
  type CanvasProjection,
} from '../lib/realtime/document'
import { issueRealtimeToken } from './auth'
import type { DatabaseAdapter, QueryResult } from './db'
import { ProjectRuntime, type ProjectRuntimeState } from './project-runtime'
import { createRealtimeServer } from './server'

const JWT_SECRET = 'jwt-secret'
const CANVAS_AUTH_SECRET = 'canvas-secret'
const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'
const OWNER_USER_ID = '550e8400-e29b-41d4-a716-446655440001'

type LoadedProjectDocument = {
  doc: Y.Doc
  snapshotSeq: number
  durableSeq: number
  projectedSeq: number
}

type ProjectionWrite = {
  projectId: string
  targetSeq: number
  projection: CanvasProjection
}

type LagEntry = {
  projectId: string
  durableSeq: number
  projectedSeq: number
  lag: number
}

type ProviderClient = {
  provider: HocuspocusProvider
  document: Y.Doc
  synced: Promise<void>
  outcome: Promise<'authenticated' | 'authenticationFailed' | 'closed'>
  statelessMessages: Array<
    | { type: 'STATUS'; status: ProjectRuntimeState; projectId: string }
    | { type: 'ACK'; status: 'PERSISTED'; projectId: string; seq: number }
  >
}

type ProjectState = {
  snapshot: Uint8Array | null
  snapshotSeq: number
  durableSeq: number
  projectedSeq: number
  updates: Array<{ seq: number; update: Uint8Array }>
  projection: CanvasProjection
}

class InMemoryRealtimeRepository {
  readonly owners = new Map<string, Set<string>>()
  readonly projects = new Map<string, ProjectState>()
  readonly projectionWrites: ProjectionWrite[] = []
  readonly appendCalls: Array<{ projectId: string; update: Uint8Array }> = []
  readonly loadCalls: string[] = []

  appendFailuresRemaining = 0
  projectionFailuresRemaining = 0

  setOwner(projectId: string, userId: string): void {
    const owners = this.owners.get(projectId) ?? new Set<string>()
    owners.add(userId)
    this.owners.set(projectId, owners)
  }

  seedProject(projectId: string, doc: Y.Doc): void {
    this.projects.set(projectId, {
      snapshot: Y.encodeStateAsUpdate(doc),
      snapshotSeq: 0,
      durableSeq: 0,
      projectedSeq: 0,
      updates: [],
      projection: structuredClone(readCanvasProjection(doc)),
    })
  }

  async ownsProject(projectId: string, userId: string): Promise<boolean> {
    return this.owners.get(projectId)?.has(userId) ?? false
  }

  async loadOrImport(projectId: string): Promise<LoadedProjectDocument> {
    this.loadCalls.push(projectId)
    const state = this.requireProject(projectId)
    return {
      doc: this.rebuildDocument(projectId),
      snapshotSeq: state.snapshotSeq,
      durableSeq: state.durableSeq,
      projectedSeq: state.projectedSeq,
    }
  }

  async appendUpdate(projectId: string, update: Uint8Array): Promise<number> {
    this.appendCalls.push({ projectId, update: new Uint8Array(update) })
    if (this.appendFailuresRemaining > 0) {
      this.appendFailuresRemaining -= 1
      throw new Error('simulated persistence outage')
    }

    const state = this.requireProject(projectId)
    const seq = state.durableSeq + 1
    state.durableSeq = seq
    state.updates.push({ seq, update: new Uint8Array(update) })
    return seq
  }

  async compact(projectId: string, snapshot: Uint8Array, includedSeq: number): Promise<void> {
    const state = this.requireProject(projectId)
    state.snapshot = new Uint8Array(snapshot)
    state.snapshotSeq = includedSeq
    state.updates = state.updates.filter((entry) => entry.seq > includedSeq)
  }

  async projectDocument(projectId: string, projection: CanvasProjection, targetSeq: number): Promise<void> {
    if (this.projectionFailuresRemaining > 0) {
      this.projectionFailuresRemaining -= 1
      throw new Error('simulated projection outage')
    }

    const state = this.requireProject(projectId)
    state.projection = structuredClone(projection)
    state.projectedSeq = targetSeq
    this.projectionWrites.push({ projectId, targetSeq, projection: structuredClone(projection) })
  }

  async loadProjectionLag(): Promise<LagEntry[]> {
    return [...this.projects.entries()]
      .map(([projectId, state]) => ({
        projectId,
        durableSeq: state.durableSeq,
        projectedSeq: state.projectedSeq,
        lag: state.durableSeq - state.projectedSeq,
      }))
      .filter((entry) => entry.projectedSeq < entry.durableSeq)
      .sort((a, b) => b.lag - a.lag || a.projectId.localeCompare(b.projectId))
  }

  async close(): Promise<void> {}

  snapshotAt(projectId: string, includedSeq: number): void {
    const state = this.requireProject(projectId)
    const snapshotDoc = this.rebuildDocument(projectId, includedSeq)
    state.snapshot = Y.encodeStateAsUpdate(snapshotDoc)
    state.snapshotSeq = includedSeq
    state.updates = state.updates.filter((entry) => entry.seq > includedSeq)
  }

  getProjectedSeq(projectId: string): number {
    return this.requireProject(projectId).projectedSeq
  }

  getDurableSeq(projectId: string): number {
    return this.requireProject(projectId).durableSeq
  }

  private requireProject(projectId: string): ProjectState {
    const state = this.projects.get(projectId)
    assert.ok(state, `expected in-memory project ${projectId}`)
    return state
  }

  private rebuildDocument(projectId: string, stopAtSeq = Number.POSITIVE_INFINITY): Y.Doc {
    const state = this.requireProject(projectId)
    const doc = new Y.Doc()
    if (state.snapshot) {
      Y.applyUpdate(doc, state.snapshot)
    }
    for (const entry of state.updates) {
      if (entry.seq > stopAtSeq) break
      Y.applyUpdate(doc, entry.update)
    }
    return doc
  }
}

class FakeAuthorizationDatabase implements DatabaseAdapter {
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<QueryResult<Row>> {
    throw new Error('query is not used in collaboration integration tests')
  }

  async transaction<T>(
    work: (client: {
      query<Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params?: readonly unknown[],
      ): Promise<QueryResult<Row>>
    }) => Promise<T>,
  ): Promise<T> {
    return work({
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<QueryResult<Row>> => {
        throw new Error('transaction query is not used in collaboration integration tests')
      },
    })
  }

  async close(): Promise<void> {}
}

function roomName(projectId = PROJECT_ID) {
  return `project:${projectId}`
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function parseStatelessMessage(payload: string) {
  try {
    return JSON.parse(payload) as ProviderClient['statelessMessages'][number]
  } catch {
    return null
  }
}

async function connectProvider({
  url,
  name,
  token,
  document = new Y.Doc(),
}: {
  url: string
  name: string
  token: string | (() => Promise<string>)
  document?: Y.Doc
}): Promise<ProviderClient> {
  let syncedResolve!: () => void
  let outcomeResolve!: (value: 'authenticated' | 'authenticationFailed' | 'closed') => void
  let outcomeReject!: (error: unknown) => void
  const synced = new Promise<void>((resolve) => {
    syncedResolve = resolve
  })
  const outcome = new Promise<'authenticated' | 'authenticationFailed' | 'closed'>((resolve, reject) => {
    outcomeResolve = resolve
    outcomeReject = reject
  })
  const statelessMessages: ProviderClient['statelessMessages'] = []

  let settled = false
  const settle = (value: 'authenticated' | 'authenticationFailed' | 'closed') => {
    if (settled) return
    settled = true
    outcomeResolve(value)
  }

  const provider = new HocuspocusProvider({
    url,
    name,
    document,
    token,
    autoConnect: false,
    forceSyncInterval: false,
    preserveTrailingSlash: false,
    timeout: 1_000,
    delay: 10,
    initialDelay: 0,
    minDelay: 0,
    factor: 1,
    maxAttempts: 1,
    jitter: false,
    messageReconnectTimeout: 2_000,
    onAuthenticated() {
      settle('authenticated')
    },
    onAuthenticationFailed() {
      settle('authenticationFailed')
    },
    onClose() {
      settle('closed')
    },
    onSynced({ state }: { state: boolean }) {
      if (state) syncedResolve()
    },
    onStateless({ payload }: { payload: string }) {
      const parsed = parseStatelessMessage(payload)
      if (parsed) statelessMessages.push(parsed)
    },
  } as any)

  void provider.connect().catch((error) => {
    if (settled) return
    settled = true
    outcomeReject(error)
  })

  return { provider, document, synced, outcome, statelessMessages }
}

function findNode(doc: Y.Doc, nodeId: string) {
  return readCanvasProjection(doc).nodes.find((node) => node.id === nodeId)
}

function findParticipantStates(provider: HocuspocusProvider, participantId: string) {
  return Array.from(provider.awareness?.getStates().values() ?? []).filter(
    (state) => state && typeof state === 'object' && state.participantId === participantId,
  ) as Array<Record<string, any>>
}

function setAwarenessState(client: ProviderClient, state: Record<string, unknown>): void {
  client.provider.awareness?.setLocalState(state)
}

function createRuntimeFactory(repository: InMemoryRealtimeRepository, overrides: Partial<ConstructorParameters<typeof ProjectRuntime>[0]['config']> = {}) {
  return ({ projectId, doc, onStateChange }: { projectId: string; doc: Y.Doc; onStateChange?: (state: ProjectRuntimeState) => void }) =>
    new ProjectRuntime({
      projectId,
      doc,
      repository,
      projectDocument: async (targetProjectId, projection, targetSeq) => {
        await repository.projectDocument(targetProjectId, projection, targetSeq)
      },
      onStateChange,
      random: () => 0,
      config: {
        batchWindowMs: 0,
        retryBaseMs: 10,
        retryMaxMs: 10,
        retryJitterRatio: 0,
        projectionDebounceMs: 0,
        projectionRetryBaseMs: 10,
        projectionRetryMaxMs: 10,
        snapshotIdleMs: 0,
        snapshotIntervalMs: 0,
        compactAfterUpdates: 10_000,
        compactAfterBytes: 10_000_000,
        maxQueuedUpdates: 64,
        maxQueuedBytes: 1_000_000,
        ...overrides,
      },
    })
}

test('real realtime collaboration converges across more than three clients for different-node, same-field, and delete/edit races', async () => {
  const repository = new InMemoryRealtimeRepository()
  repository.setOwner(PROJECT_ID, OWNER_USER_ID)

  const seeded = createCanvasDocument()
  upsertNode(seeded, {
    id: 'shared-node',
    type: 'prompt',
    position: { x: 10, y: 20 },
    data: { label: 'seed' },
  })
  upsertNode(seeded, {
    id: 'race-node',
    type: 'prompt',
    position: { x: 20, y: 30 },
    data: { label: 'before' },
  })
  repository.seedProject(PROJECT_ID, seeded)

  const server = createRealtimeServer({
    address: '127.0.0.1',
    port: 0,
    env: {
      REALTIME_TOKEN_SECRET: JWT_SECRET,
      CANVAS_AUTH_SECRET,
    },
    repository,
    database: new FakeAuthorizationDatabase(),
    createRuntime: createRuntimeFactory(repository),
  })

  await server.listen()
  const token = (await issueRealtimeToken({ userId: OWNER_USER_ID, projectId: PROJECT_ID }, JWT_SECRET)).token
  const clients = await Promise.all([
    connectProvider({ url: server.wsUrl, name: roomName(), token }),
    connectProvider({ url: server.wsUrl, name: roomName(), token }),
    connectProvider({ url: server.wsUrl, name: roomName(), token }),
    connectProvider({ url: server.wsUrl, name: roomName(), token }),
    connectProvider({ url: server.wsUrl, name: roomName(), token }),
  ])

  try {
    await Promise.all(clients.map((client) => client.synced))
    assert.equal(server.getConnectionCount(), 5)

    upsertNode(clients[0].document, {
      id: 'alpha-node',
      type: 'image',
      position: { x: 101, y: 201 },
      data: { label: 'alpha' },
    })
    upsertNode(clients[1].document, {
      id: 'beta-node',
      type: 'video',
      position: { x: 202, y: 303 },
      data: { label: 'beta' },
    })

    await waitFor(() => clients.every((client) => !!findNode(client.document, 'alpha-node')))
    await waitFor(() => clients.every((client) => !!findNode(client.document, 'beta-node')))

    patchNode(clients[2].document, 'shared-node', { type: 'image' })
    patchNode(clients[3].document, 'shared-node', { type: 'video' })

    await waitFor(() => {
      const types = clients.map((client) => findNode(client.document, 'shared-node')?.type)
      return types.every((type) => type === types[0] && (type === 'image' || type === 'video'))
    })

    deleteNode(clients[1].document, 'race-node')
    patchNode(clients[4].document, 'race-node', { data: { label: 'after' } })

    await waitFor(() => clients.every((client) => !findNode(client.document, 'race-node')))

    const finalProjection = readCanvasProjection(clients[0].document)
    assert.equal(finalProjection.nodes.some((node) => node.id === 'alpha-node'), true)
    assert.equal(finalProjection.nodes.some((node) => node.id === 'beta-node'), true)
    assert.equal(finalProjection.nodes.some((node) => node.id === 'race-node'), false)
    assert.ok(['image', 'video'].includes(findNode(clients[0].document, 'shared-node')?.type ?? ''))
  } finally {
    for (const client of clients) {
      client.provider.destroy()
    }
    await waitFor(() => server.getConnectionCount() === 0)
    await server.destroy()
  }
})

test('same-user sockets get separate participant identities and disconnect cleanup removes presence', async () => {
  const repository = new InMemoryRealtimeRepository()
  repository.setOwner(PROJECT_ID, OWNER_USER_ID)
  repository.seedProject(PROJECT_ID, createCanvasDocument())

  const server = createRealtimeServer({
    address: '127.0.0.1',
    port: 0,
    env: {
      REALTIME_TOKEN_SECRET: JWT_SECRET,
      CANVAS_AUTH_SECRET,
    },
    repository,
    database: new FakeAuthorizationDatabase(),
    createRuntime: createRuntimeFactory(repository),
  })

  await server.listen()
  const token = (await issueRealtimeToken({ userId: OWNER_USER_ID, projectId: PROJECT_ID }, JWT_SECRET)).token
  const alpha = await connectProvider({ url: server.wsUrl, name: roomName(), token })
  const beta = await connectProvider({ url: server.wsUrl, name: roomName(), token })
  const observer = await connectProvider({ url: server.wsUrl, name: roomName(), token })

  try {
    await Promise.all([alpha.synced, beta.synced, observer.synced])

    setAwarenessState(alpha, {
      participantId: 'shared-participant',
      userId: 'forged-alpha',
      name: 'Mallory',
      cursor: { x: 1, y: 2 },
    })
    setAwarenessState(beta, {
      participantId: 'shared-participant',
      userId: 'forged-beta',
      name: 'Eve',
      cursor: { x: 3, y: 4 },
    })

    await waitFor(() => findParticipantStates(observer.provider, 'shared-participant').length === 2)
    const participantStates = findParticipantStates(observer.provider, 'shared-participant')
    const names = participantStates.map((state) => state.name).sort()

    assert.deepEqual(names, ['Guest 1', 'Guest 2'])
    assert.equal(participantStates.every((state) => state.userId === OWNER_USER_ID), true)

    beta.provider.destroy()
    await waitFor(() => server.getConnectionCount() === 2)
    await waitFor(() => findParticipantStates(observer.provider, 'shared-participant').length === 1)
    assert.equal(findParticipantStates(observer.provider, 'shared-participant')[0]?.name, 'Guest 1')
  } finally {
    alpha.provider.destroy()
    observer.provider.destroy()
    await waitFor(() => server.getConnectionCount() === 0)
    await server.destroy()
  }
})

test('provider async JWT callback runs again on reconnect', async () => {
  const repository = new InMemoryRealtimeRepository()
  repository.setOwner(PROJECT_ID, OWNER_USER_ID)
  repository.seedProject(PROJECT_ID, createCanvasDocument())

  const server = createRealtimeServer({
    address: '127.0.0.1',
    port: 0,
    env: {
      REALTIME_TOKEN_SECRET: JWT_SECRET,
      CANVAS_AUTH_SECRET,
    },
    repository,
    database: new FakeAuthorizationDatabase(),
    createRuntime: createRuntimeFactory(repository),
  })

  await server.listen()

  let tokenCalls = 0
  const token = async () => {
    tokenCalls += 1
    return (await issueRealtimeToken({ userId: OWNER_USER_ID, projectId: PROJECT_ID }, JWT_SECRET)).token
  }

  const first = await connectProvider({
    url: server.wsUrl,
    name: roomName(),
    token,
  })

  try {
    await first.synced
    await waitFor(() => tokenCalls === 1)

    first.provider.destroy()
    await waitFor(() => server.getConnectionCount() === 0)

    const second = await connectProvider({
      url: server.wsUrl,
      name: roomName(),
      token,
    })
    try {
      await second.synced
      await waitFor(() => tokenCalls >= 2)
    } finally {
      second.provider.destroy()
      await waitFor(() => server.getConnectionCount() === 0)
    }
  } finally {
    await server.destroy()
  }
})

test('hard restart rehydrates from snapshot plus updates and catches projection lag up to durable seq', async () => {
  const repository = new InMemoryRealtimeRepository()
  repository.setOwner(PROJECT_ID, OWNER_USER_ID)
  repository.seedProject(PROJECT_ID, createCanvasDocument())

  const createServer = () => createRealtimeServer({
    address: '127.0.0.1',
    port: 0,
    env: {
      REALTIME_TOKEN_SECRET: JWT_SECRET,
      CANVAS_AUTH_SECRET,
    },
    repository,
    database: new FakeAuthorizationDatabase(),
    createRuntime: createRuntimeFactory(repository),
  })

  let server = createServer()
  await server.listen()
  const token = (await issueRealtimeToken({ userId: OWNER_USER_ID, projectId: PROJECT_ID }, JWT_SECRET)).token
  const first = await connectProvider({ url: server.wsUrl, name: roomName(), token })

  try {
    await first.synced

    upsertNode(first.document, {
      id: 'snapshotted-node',
      type: 'prompt',
      position: { x: 10, y: 10 },
      data: { label: 'snapshot' },
    })
    await waitFor(() => repository.getDurableSeq(PROJECT_ID) === 1)
    repository.snapshotAt(PROJECT_ID, 1)

    upsertNode(first.document, {
      id: 'tail-node',
      type: 'image',
      position: { x: 20, y: 20 },
      data: { label: 'tail' },
    })
    await waitFor(() => repository.getDurableSeq(PROJECT_ID) === 2)
    repository.projects.get(PROJECT_ID)!.projectedSeq = 0

    first.provider.destroy()
    await waitFor(() => server.getConnectionCount() === 0)
    await server.destroy()

    server = createServer()
    await server.listen()

    const restarted = await connectProvider({ url: server.wsUrl, name: roomName(), token })
    try {
      await restarted.synced
      await waitFor(() => !!findNode(restarted.document, 'snapshotted-node'))
      await waitFor(() => !!findNode(restarted.document, 'tail-node'))
      await waitFor(() => repository.getProjectedSeq(PROJECT_ID) === repository.getDurableSeq(PROJECT_ID))

      assert.equal(findNode(restarted.document, 'snapshotted-node')?.data.label, 'snapshot')
      assert.equal(findNode(restarted.document, 'tail-node')?.data.label, 'tail')
      assert.equal(repository.getProjectedSeq(PROJECT_ID), 2)
    } finally {
      restarted.provider.destroy()
      await waitFor(() => server.getConnectionCount() === 0)
    }
  } finally {
    await server.destroy()
  }
})

test('persistence outage degrades to bounded read-only and recovers back to persisted writable collaboration', async () => {
  const repository = new InMemoryRealtimeRepository()
  repository.setOwner(PROJECT_ID, OWNER_USER_ID)
  repository.seedProject(PROJECT_ID, createCanvasDocument())
  repository.appendFailuresRemaining = 1_000

  const server = createRealtimeServer({
    address: '127.0.0.1',
    port: 0,
    env: {
      REALTIME_TOKEN_SECRET: JWT_SECRET,
      CANVAS_AUTH_SECRET,
    },
    repository,
    database: new FakeAuthorizationDatabase(),
    createRuntime: createRuntimeFactory(repository, {
      maxQueuedUpdates: 2,
      maxQueuedBytes: 1_000_000,
    }),
  })

  await server.listen()
  const token = (await issueRealtimeToken({ userId: OWNER_USER_ID, projectId: PROJECT_ID }, JWT_SECRET)).token
  const first = await connectProvider({ url: server.wsUrl, name: roomName(), token })
  const second = await connectProvider({ url: server.wsUrl, name: roomName(), token })

  try {
    await Promise.all([first.synced, second.synced])

    upsertNode(first.document, {
      id: 'queued-1',
      type: 'prompt',
      position: { x: 1, y: 1 },
      data: { label: 'first' },
    })
    await waitFor(() => first.statelessMessages.some((message) => message.type === 'STATUS' && message.status === 'DEGRADED'))

    upsertNode(first.document, {
      id: 'queued-2',
      type: 'prompt',
      position: { x: 2, y: 2 },
      data: { label: 'second' },
    })
    await waitFor(() => first.statelessMessages.some((message) => message.type === 'STATUS' && message.status === 'READ_ONLY'))
    await waitFor(() => second.statelessMessages.some((message) => message.type === 'STATUS' && message.status === 'READ_ONLY'))

    upsertNode(second.document, {
      id: 'blocked-3',
      type: 'prompt',
      position: { x: 3, y: 3 },
      data: { label: 'blocked' },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(findNode(first.document, 'blocked-3'), undefined)

    repository.appendFailuresRemaining = 0
    await waitFor(() => first.statelessMessages.some((message) => message.type === 'ACK' && message.seq === 1))
    await waitFor(() => first.statelessMessages.some((message) => message.type === 'STATUS' && message.status === 'SYNCED'))

    upsertNode(second.document, {
      id: 'recovered-4',
      type: 'image',
      position: { x: 4, y: 4 },
      data: { label: 'recovered' },
    })

    await waitFor(() => second.statelessMessages.some((message) => message.type === 'ACK' && message.seq === 2))
    await waitFor(() => !!findNode(first.document, 'recovered-4'))
    await waitFor(() => !!findNode(second.document, 'recovered-4'))

    assert.equal(repository.getDurableSeq(PROJECT_ID), 2)
    assert.equal(findNode(first.document, 'queued-1')?.data.label, 'first')
    assert.equal(findNode(first.document, 'queued-2')?.data.label, 'second')
  } finally {
    first.provider.destroy()
    second.provider.destroy()
    await waitFor(() => server.getConnectionCount() === 0)
    await server.destroy()
  }
})
