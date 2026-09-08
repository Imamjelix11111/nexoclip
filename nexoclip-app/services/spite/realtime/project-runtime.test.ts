import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'

import {
  CURRENT_SCHEMA_VERSION,
  createCanvasDocument,
  patchNode,
  readCanvasProjection,
  upsertNode,
} from '../lib/realtime/document'
import { ProjectRuntime, type ProjectRuntimeState } from './project-runtime'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

type AppendCall = {
  projectId: string
  update: Uint8Array
}

type CompactCall = {
  projectId: string
  snapshot: Uint8Array
  includedSeq: number
  schemaVersion: number
}

type ProjectCall = {
  projectId: string
  payload: ReturnType<typeof readCanvasProjection>
  targetSeq: number
}

class FakeClock {
  now = 0

  private nextTimerId = 1
  private readonly timers = new Map<
    number,
    {
      id: number
      dueAt: number
      callback: () => void | Promise<void>
    }
  >()

  setTimeout = (callback: () => void | Promise<void>, delayMs: number): number => {
    const id = this.nextTimerId++
    this.timers.set(id, {
      id,
      dueAt: this.now + Math.max(0, delayMs),
      callback,
    })
    return id
  }

  clearTimeout = (timerId: number | null | undefined): void => {
    if (typeof timerId === 'number') {
      this.timers.delete(timerId)
    }
  }

  async advanceBy(delayMs: number): Promise<void> {
    const target = this.now + Math.max(0, delayMs)

    while (true) {
      const next = this.nextDueTimer(target)
      if (!next) break

      this.now = next.dueAt
      this.timers.delete(next.id)
      await next.callback()
      await flushMicrotasks()
    }

    this.now = target
    await flushMicrotasks()
  }

  private nextDueTimer(target: number) {
    let winner: { id: number; dueAt: number; callback: () => void | Promise<void> } | null = null

    for (const timer of this.timers.values()) {
      if (timer.dueAt > target) continue
      if (!winner || timer.dueAt < winner.dueAt || (timer.dueAt === winner.dueAt && timer.id < winner.id)) {
        winner = timer
      }
    }

    return winner
  }
}

class FakeRepository {
  readonly appendCalls: AppendCall[] = []
  readonly compactCalls: CompactCall[] = []

  appendBehavior: (call: AppendCall) => Promise<number> = async () => 1
  compactBehavior: (call: CompactCall) => Promise<void> = async () => {}

  async appendUpdate(projectId: string, update: Uint8Array): Promise<number> {
    const call = {
      projectId,
      update: new Uint8Array(update),
    }
    this.appendCalls.push(call)
    return this.appendBehavior(call)
  }

  async compact(
    projectId: string,
    snapshot: Uint8Array,
    includedSeq: number,
    schemaVersion: number,
  ): Promise<void> {
    const call = {
      projectId,
      snapshot: new Uint8Array(snapshot),
      includedSeq,
      schemaVersion,
    }
    this.compactCalls.push(call)
    await this.compactBehavior(call)
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function captureUpdate(doc: Y.Doc, mutate: () => void): Uint8Array {
  let captured: Uint8Array | null = null
  const onUpdate = (update: Uint8Array) => {
    captured = new Uint8Array(update)
  }

  doc.on('update', onUpdate)
  mutate()
  doc.off('update', onUpdate)

  assert.ok(captured, 'expected a Yjs update from mutation')
  return captured
}

function decodeProjection(update: Uint8Array) {
  const doc = createCanvasDocument()
  Y.applyUpdate(doc, update)
  return readCanvasProjection(doc)
}

function createRuntimeFixture(options: {
  projectId?: string
  projectionDebounceMs?: number
  projectionRetryBaseMs?: number
  snapshotIdleMs?: number
  snapshotIntervalMs?: number
  batchWindowMs?: number
  retryBaseMs?: number
  retryMaxMs?: number
  retryJitterRatio?: number
  projectionRetryMaxMs?: number
  maxQueuedUpdates?: number
  maxQueuedBytes?: number
}) {
  const projectId = options.projectId ?? '550e8400-e29b-41d4-a716-446655440000'
  const clock = new FakeClock()
  const repository = new FakeRepository()
  const doc = createCanvasDocument()
  const states: ProjectRuntimeState[] = []
  const projectionCalls: ProjectCall[] = []
  const projectionBehaviors: Array<() => Promise<void>> = []

  const runtime = new ProjectRuntime({
    projectId,
    doc,
    repository,
    projectDocument: async (projectionProjectId, payload, targetSeq) => {
      projectionCalls.push({
        projectId: projectionProjectId,
        payload: structuredClone(payload),
        targetSeq,
      })

      const next = projectionBehaviors.shift()
      if (next) {
        await next()
      }
    },
    clock,
    random: () => 0.5,
    onStateChange: (state) => {
      states.push(state)
    },
    config: {
      batchWindowMs: options.batchWindowMs ?? 25,
      retryBaseMs: options.retryBaseMs ?? 100,
      retryMaxMs: options.retryMaxMs ?? 1_000,
      retryJitterRatio: options.retryJitterRatio ?? 0.5,
      projectionDebounceMs: options.projectionDebounceMs ?? 1_000,
      projectionRetryBaseMs: options.projectionRetryBaseMs ?? 200,
      projectionRetryMaxMs: options.projectionRetryMaxMs ?? 2_000,
      snapshotIdleMs: options.snapshotIdleMs ?? 5_000,
      snapshotIntervalMs: options.snapshotIntervalMs ?? 30_000,
      maxQueuedUpdates: options.maxQueuedUpdates ?? 64,
      maxQueuedBytes: options.maxQueuedBytes ?? 128 * 1024,
    },
  })

  return {
    projectId,
    clock,
    repository,
    doc,
    runtime,
    states,
    projectionCalls,
    projectionBehaviors,
  }
}

test('enqueue merge-batches updates and resolves ACK only after append commit', async () => {
  const fixture = createRuntimeFixture({ projectionDebounceMs: 5_000, snapshotIdleMs: 60_000, snapshotIntervalMs: 60_000 })
  const appendDeferred = deferred<number>()
  fixture.repository.appendBehavior = async () => appendDeferred.promise

  const firstUpdate = captureUpdate(fixture.doc, () => {
    upsertNode(fixture.doc, {
      id: 'node-1',
      type: 'prompt',
      position: { x: 10, y: 20 },
      data: { label: 'A' },
    })
  })
  const secondUpdate = captureUpdate(fixture.doc, () => {
    patchNode(fixture.doc, 'node-1', {
      position: { x: 30, y: 40 },
      data: { label: 'B' },
    })
  })

  let firstAck: number | null = null
  let secondAck: number | null = null

  const firstPromise = fixture.runtime.enqueue(firstUpdate).then((seq) => {
    firstAck = seq
    return seq
  })
  const secondPromise = fixture.runtime.enqueue(secondUpdate).then((seq) => {
    secondAck = seq
    return seq
  })

  await fixture.clock.advanceBy(24)
  assert.equal(fixture.repository.appendCalls.length, 0)
  assert.equal(firstAck, null)
  assert.equal(secondAck, null)

  await fixture.clock.advanceBy(1)
  assert.equal(fixture.repository.appendCalls.length, 1)
  assert.deepEqual(
    Buffer.from(fixture.repository.appendCalls[0].update),
    Buffer.from(Y.mergeUpdates([firstUpdate, secondUpdate])),
  )
  assert.equal(firstAck, null)
  assert.equal(secondAck, null)

  appendDeferred.resolve(7)
  assert.equal(await firstPromise, 7)
  assert.equal(await secondPromise, 7)
  assert.equal(firstAck, 7)
  assert.equal(secondAck, 7)
  assert.deepEqual(fixture.states, ['PERSISTING', 'PERSISTED', 'SYNCED'])
})

test('append retries with exponential backoff and jitter while ACK waits for success', async () => {
  const fixture = createRuntimeFixture({ projectionDebounceMs: 5_000, snapshotIdleMs: 60_000, snapshotIntervalMs: 60_000 })
  const failures = [new Error('append-1'), new Error('append-2')]
  fixture.repository.appendBehavior = async () => {
    const nextFailure = failures.shift()
    if (nextFailure) throw nextFailure
    return 5
  }

  const update = captureUpdate(fixture.doc, () => {
    upsertNode(fixture.doc, {
      id: 'node-1',
      type: 'prompt',
      position: { x: 1, y: 2 },
      data: { label: 'retry-me' },
    })
  })

  let resolved = false
  const ackPromise = fixture.runtime.enqueue(update).then((seq) => {
    resolved = true
    return seq
  })

  await fixture.clock.advanceBy(25)
  assert.equal(fixture.repository.appendCalls.length, 1)
  assert.equal(resolved, false)
  assert.deepEqual(fixture.states, ['PERSISTING', 'DEGRADED'])

  await fixture.clock.advanceBy(124)
  assert.equal(fixture.repository.appendCalls.length, 1)

  await fixture.clock.advanceBy(1)
  assert.equal(fixture.repository.appendCalls.length, 2)
  assert.equal(resolved, false)

  await fixture.clock.advanceBy(249)
  assert.equal(fixture.repository.appendCalls.length, 2)

  await fixture.clock.advanceBy(1)
  assert.equal(fixture.repository.appendCalls.length, 3)
  assert.equal(await ackPromise, 5)
  assert.equal(resolved, true)
  assert.deepEqual(fixture.states, ['PERSISTING', 'DEGRADED', 'PERSISTED', 'SYNCED'])
})

test('queue exhaustion transitions DEGRADED to READ_ONLY, rejects new mutations, and recovers after flush', async () => {
  const fixture = createRuntimeFixture({
    projectionDebounceMs: 5_000,
    snapshotIdleMs: 60_000,
    snapshotIntervalMs: 60_000,
    maxQueuedUpdates: 2,
    retryBaseMs: 100,
    retryJitterRatio: 0,
  })
  let shouldFail = true
  fixture.repository.appendBehavior = async () => {
    if (shouldFail) throw new Error('neon down')
    return 9
  }

  const firstUpdate = captureUpdate(fixture.doc, () => {
    upsertNode(fixture.doc, {
      id: 'node-1',
      type: 'prompt',
      position: { x: 1, y: 1 },
      data: { label: 'one' },
    })
  })
  const secondUpdate = captureUpdate(fixture.doc, () => {
    patchNode(fixture.doc, 'node-1', {
      data: { label: 'two' },
    })
  })
  const thirdUpdate = captureUpdate(fixture.doc, () => {
    patchNode(fixture.doc, 'node-1', {
      data: { label: 'three' },
    })
  })

  let firstAckResolved = false
  const firstAckPromise = fixture.runtime.enqueue(firstUpdate).then((seq) => {
    firstAckResolved = true
    return seq
  })
  await fixture.clock.advanceBy(25)
  assert.equal(firstAckResolved, false)

  const secondAckPromise = fixture.runtime.enqueue(secondUpdate)
  assert.equal(fixture.runtime.canAcceptMutation(), false)
  await assert.rejects(fixture.runtime.enqueue(thirdUpdate), /read-only/i)
  assert.deepEqual(fixture.states, ['PERSISTING', 'DEGRADED', 'READ_ONLY'])

  shouldFail = false
  await fixture.clock.advanceBy(100)
  assert.equal(await firstAckPromise, 9)
  assert.equal(await secondAckPromise, 9)
  await fixture.runtime.flush()

  assert.equal(fixture.runtime.canAcceptMutation(), true)
  assert.deepEqual(fixture.states, ['PERSISTING', 'DEGRADED', 'READ_ONLY', 'PERSISTED', 'SYNCED'])
})

test('projection capture stays on the exact durable boundary and retries asynchronously', async () => {
  const fixture = createRuntimeFixture({
    projectionDebounceMs: 1_000,
    projectionRetryBaseMs: 200,
    projectionRetryMaxMs: 1_000,
    retryJitterRatio: 0,
    snapshotIdleMs: 60_000,
    snapshotIntervalMs: 60_000,
  })
  fixture.repository.appendBehavior = async () => 4
  fixture.projectionBehaviors.push(async () => {
    throw new Error('project-fail')
  })
  fixture.projectionBehaviors.push(async () => {})

  const committedUpdate = captureUpdate(fixture.doc, () => {
    upsertNode(fixture.doc, {
      id: 'node-1',
      type: 'prompt',
      position: { x: 10, y: 20 },
      data: { label: 'committed' },
    })
  })

  const ackPromise = fixture.runtime.enqueue(committedUpdate)
  await fixture.clock.advanceBy(25)
  assert.equal(await ackPromise, 4)

  captureUpdate(fixture.doc, () => {
    patchNode(fixture.doc, 'node-1', {
      data: { label: 'not-durable-yet' },
      position: { x: 99, y: 100 },
    })
  })

  await fixture.clock.advanceBy(1_000)
  assert.equal(fixture.projectionCalls.length, 1)
  assert.equal(fixture.projectionCalls[0].targetSeq, 4)
  assert.deepEqual(fixture.projectionCalls[0].payload.nodes, [
    {
      id: 'node-1',
      type: 'prompt',
      position: { x: 10, y: 20 },
      data: { label: 'committed' },
    },
  ])

  await fixture.clock.advanceBy(199)
  assert.equal(fixture.projectionCalls.length, 1)

  await fixture.clock.advanceBy(1)
  assert.equal(fixture.projectionCalls.length, 2)
  assert.equal(fixture.projectionCalls[1].targetSeq, 4)
  assert.deepEqual(fixture.projectionCalls[1].payload, fixture.projectionCalls[0].payload)
})

test('idle compaction snapshots only the latest durable boundary', async () => {
  const fixture = createRuntimeFixture({
    projectionDebounceMs: 5_000,
    snapshotIdleMs: 5_000,
    snapshotIntervalMs: 60_000,
  })
  fixture.repository.appendBehavior = async () => 1

  const committedUpdate = captureUpdate(fixture.doc, () => {
    upsertNode(fixture.doc, {
      id: 'node-1',
      type: 'prompt',
      position: { x: 5, y: 6 },
      data: { label: 'durable' },
    })
  })

  const ackPromise = fixture.runtime.enqueue(committedUpdate)
  await fixture.clock.advanceBy(25)
  await ackPromise

  captureUpdate(fixture.doc, () => {
    patchNode(fixture.doc, 'node-1', {
      data: { label: 'live-only' },
      position: { x: 70, y: 80 },
    })
  })

  await fixture.clock.advanceBy(4_999)
  assert.equal(fixture.repository.compactCalls.length, 0)

  await fixture.clock.advanceBy(1)
  assert.equal(fixture.repository.compactCalls.length, 1)
  assert.equal(fixture.repository.compactCalls[0].includedSeq, 1)
  assert.equal(fixture.repository.compactCalls[0].schemaVersion, CURRENT_SCHEMA_VERSION)
  assert.deepEqual(decodeProjection(fixture.repository.compactCalls[0].snapshot).nodes, [
    {
      id: 'node-1',
      type: 'prompt',
      position: { x: 5, y: 6 },
      data: { label: 'durable' },
    },
  ])
})

test('periodic compaction runs even without an idle window', async () => {
  const fixture = createRuntimeFixture({
    projectionDebounceMs: 5_000,
    snapshotIdleMs: 60_000,
    snapshotIntervalMs: 30_000,
  })
  fixture.repository.appendBehavior = async () => 2

  const update = captureUpdate(fixture.doc, () => {
    upsertNode(fixture.doc, {
      id: 'node-1',
      type: 'prompt',
      position: { x: 2, y: 3 },
      data: { label: 'periodic' },
    })
  })

  const ackPromise = fixture.runtime.enqueue(update)
  await fixture.clock.advanceBy(25)
  await ackPromise

  await fixture.clock.advanceBy(29_999)
  assert.equal(fixture.repository.compactCalls.length, 0)

  await fixture.clock.advanceBy(1)
  assert.equal(fixture.repository.compactCalls.length, 1)
  assert.equal(fixture.repository.compactCalls[0].includedSeq, 2)
})

test('shutdown flushes pending writes before compaction and stops new mutations', async () => {
  const fixture = createRuntimeFixture({
    projectionDebounceMs: 5_000,
    snapshotIdleMs: 60_000,
    snapshotIntervalMs: 60_000,
  })
  const appendDeferred = deferred<number>()
  fixture.repository.appendBehavior = async () => appendDeferred.promise

  const firstUpdate = captureUpdate(fixture.doc, () => {
    upsertNode(fixture.doc, {
      id: 'node-1',
      type: 'prompt',
      position: { x: 1, y: 2 },
      data: { label: 'shutdown' },
    })
  })
  const secondUpdate = captureUpdate(fixture.doc, () => {
    patchNode(fixture.doc, 'node-1', {
      data: { label: 'late' },
    })
  })

  const firstAck = fixture.runtime.enqueue(firstUpdate)
  await fixture.clock.advanceBy(25)

  const shutdownPromise = fixture.runtime.shutdown()
  await assert.rejects(fixture.runtime.enqueue(secondUpdate), /shutting down/i)
  assert.equal(fixture.repository.compactCalls.length, 0)

  appendDeferred.resolve(11)
  assert.equal(await firstAck, 11)
  await shutdownPromise

  assert.equal(fixture.repository.compactCalls.length, 1)
  assert.equal(fixture.repository.compactCalls[0].includedSeq, 11)
})
