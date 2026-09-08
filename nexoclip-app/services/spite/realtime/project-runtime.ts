import * as Y from 'yjs'

import { CURRENT_SCHEMA_VERSION, type CanvasProjection } from '../lib/realtime/document'
import { captureProjectionPayload, projectDocument } from './projector'

type ProjectRuntimeTimer = ReturnType<typeof setTimeout> | number

type MutationEntry = {
  update: Uint8Array
  bytes: number
  resolve: (seq: number) => void
  reject: (error: unknown) => void
}

type ProjectionJob = {
  payload: CanvasProjection
  targetSeq: number
  attempt: number
}

type DeferredVoid = {
  resolve: () => void
  reject: (error: unknown) => void
  promise: Promise<void>
}

export type ProjectRuntimeState =
  | 'SYNCED'
  | 'PERSISTING'
  | 'PERSISTED'
  | 'DEGRADED'
  | 'READ_ONLY'

export type ProjectRuntimeClock = {
  now?: number | (() => number)
  setTimeout: (callback: () => void | Promise<void>, delayMs: number) => ProjectRuntimeTimer
  clearTimeout: (timer: ProjectRuntimeTimer | null | undefined) => void
}

export type ProjectRuntimeRepository = {
  appendUpdate(projectId: string, update: Uint8Array): Promise<number>
  compact(
    projectId: string,
    snapshot: Uint8Array,
    includedSeq: number,
    schemaVersion: number,
  ): Promise<void>
}

export type ProjectRuntimeConfig = {
  batchWindowMs: number
  retryBaseMs: number
  retryMaxMs: number
  retryJitterRatio: number
  projectionDebounceMs: number
  projectionRetryBaseMs: number
  projectionRetryMaxMs: number
  snapshotIdleMs: number
  snapshotIntervalMs: number
  maxQueuedUpdates: number
  maxQueuedBytes: number
  schemaVersion: number
}

export type ProjectRuntimeOptions = {
  projectId: string
  doc: Y.Doc
  repository: ProjectRuntimeRepository
  projectDocument?: (
    projectId: string,
    payload: CanvasProjection,
    targetSeq: number,
  ) => Promise<void>
  captureProjectionPayload?: (doc: Y.Doc) => CanvasProjection
  clock?: ProjectRuntimeClock
  random?: () => number
  onStateChange?: (state: ProjectRuntimeState) => void
  config?: Partial<ProjectRuntimeConfig>
}

export const DEFAULT_PROJECT_RUNTIME_CONFIG: ProjectRuntimeConfig = {
  batchWindowMs: readIntegerEnv('SPITE_REALTIME_BATCH_WINDOW_MS', 25),
  retryBaseMs: readIntegerEnv('SPITE_REALTIME_RETRY_BASE_MS', 100),
  retryMaxMs: readIntegerEnv('SPITE_REALTIME_RETRY_MAX_MS', 5_000),
  retryJitterRatio: readFloatEnv('SPITE_REALTIME_RETRY_JITTER_RATIO', 0.5),
  projectionDebounceMs: readIntegerEnv('SPITE_REALTIME_PROJECTION_DEBOUNCE_MS', 1_000),
  projectionRetryBaseMs: readIntegerEnv('SPITE_REALTIME_PROJECTION_RETRY_BASE_MS', 250),
  projectionRetryMaxMs: readIntegerEnv('SPITE_REALTIME_PROJECTION_RETRY_MAX_MS', 5_000),
  snapshotIdleMs: readIntegerEnv('SPITE_REALTIME_SNAPSHOT_IDLE_MS', 5_000),
  snapshotIntervalMs: readIntegerEnv('SPITE_REALTIME_SNAPSHOT_INTERVAL_MS', 30_000),
  maxQueuedUpdates: readIntegerEnv('SPITE_REALTIME_MAX_QUEUED_UPDATES', 256),
  maxQueuedBytes: readIntegerEnv('SPITE_REALTIME_MAX_QUEUED_BYTES', 512 * 1024),
  schemaVersion: CURRENT_SCHEMA_VERSION,
}

export function readProjectRuntimeConfig(
  overrides: Partial<ProjectRuntimeConfig> = {},
): ProjectRuntimeConfig {
  return {
    ...DEFAULT_PROJECT_RUNTIME_CONFIG,
    ...overrides,
  }
}

export class ProjectRuntime {
  private readonly config: ProjectRuntimeConfig
  private readonly durableDoc: Y.Doc
  private readonly clock: ProjectRuntimeClock
  private readonly random: () => number
  private readonly onStateChange?: (state: ProjectRuntimeState) => void
  private readonly projector: (
    projectId: string,
    payload: CanvasProjection,
    targetSeq: number,
  ) => Promise<void>
  private readonly captureProjection: (doc: Y.Doc) => CanvasProjection

  private state: ProjectRuntimeState = 'SYNCED'
  private acceptingMutations = true
  private pendingEntries: MutationEntry[] = []
  private queuedUpdates = 0
  private queuedBytes = 0
  private retryAttempt = 0
  private lastDurableSeq = 0
  private lastCompactedSeq = 0

  private batchTimer: ProjectRuntimeTimer | null = null
  private retryTimer: ProjectRuntimeTimer | null = null
  private snapshotIdleTimer: ProjectRuntimeTimer | null = null
  private snapshotIntervalTimer: ProjectRuntimeTimer | null = null
  private projectionTimer: ProjectRuntimeTimer | null = null
  private projectionRetryTimer: ProjectRuntimeTimer | null = null

  private persistActive = false
  private projectionActive = false
  private projectionStopped = false
  private storageChain: Promise<void> = Promise.resolve()
  private flushWaiters: DeferredVoid[] = []
  private pendingProjection: ProjectionJob | null = null
  private committedSinceCompact = false

  constructor(
    private readonly options: ProjectRuntimeOptions,
  ) {
    this.config = readProjectRuntimeConfig(options.config)
    this.clock = options.clock ?? createSystemClock()
    this.random = options.random ?? Math.random
    this.onStateChange = options.onStateChange
    this.projector = options.projectDocument ?? projectDocument
    this.captureProjection = options.captureProjectionPayload ?? captureProjectionPayload
    this.durableDoc = new Y.Doc()
    Y.applyUpdate(this.durableDoc, Y.encodeStateAsUpdate(options.doc))
  }

  canAcceptMutation(): boolean {
    return this.acceptingMutations && this.hasWritableCapacity()
  }

  enqueue(update: Uint8Array): Promise<number> {
    if (!this.acceptingMutations) {
      return Promise.reject(new Error(`Project ${this.options.projectId} runtime is shutting down`))
    }

    if (!this.hasWritableCapacity()) {
      this.setState('READ_ONLY')
      return Promise.reject(new Error(`Project ${this.options.projectId} runtime is read-only`))
    }

    const entry = createMutationEntry(update)
    this.pendingEntries.push(entry)
    this.queuedUpdates += 1
    this.queuedBytes += entry.bytes

    if (!this.hasWritableCapacity()) {
      this.setState('READ_ONLY')
    } else if (this.state !== 'DEGRADED') {
      this.setState('PERSISTING')
    }

    this.ensurePersistScheduled()
    return entry.promise
  }

  async flush(): Promise<void> {
    if (this.batchTimer) {
      this.clearTimer('batchTimer')
      void this.runPersistAttempt()
    }

    if (this.isFullyFlushed()) {
      return
    }

    const waiter = createDeferredVoid()
    this.flushWaiters.push(waiter)
    await waiter.promise
  }

  scheduleProjection(targetSeq: number): void {
    if (this.projectionStopped || targetSeq <= 0) return

    this.pendingProjection = {
      payload: this.captureProjection(this.durableDoc),
      targetSeq,
      attempt: 0,
    }

    if (!this.projectionActive && !this.projectionRetryTimer) {
      this.scheduleProjectionTimer(this.config.projectionDebounceMs)
    }
  }

  async compact(): Promise<void> {
    await this.runStorageTask(async () => {
      if (this.lastDurableSeq <= this.lastCompactedSeq) {
        return
      }

      const snapshot = Y.encodeStateAsUpdate(this.durableDoc)
      const includedSeq = this.lastDurableSeq
      await this.options.repository.compact(
        this.options.projectId,
        snapshot,
        includedSeq,
        this.config.schemaVersion,
      )
      this.lastCompactedSeq = includedSeq
      this.committedSinceCompact = false
      this.resetSnapshotTimers()
    })
  }

  async shutdown(): Promise<void> {
    this.acceptingMutations = false
    this.projectionStopped = true
    this.pendingProjection = null
    this.clearTimer('snapshotIdleTimer')
    this.clearTimer('snapshotIntervalTimer')
    this.clearTimer('projectionTimer')
    this.clearTimer('projectionRetryTimer')

    await this.flush()
    await this.compact()
  }

  private ensurePersistScheduled(): void {
    if (this.persistActive || this.retryTimer || this.batchTimer || this.pendingEntries.length === 0) {
      return
    }

    this.batchTimer = this.clock.setTimeout(() => {
      this.batchTimer = null
      void this.runPersistAttempt()
    }, this.config.batchWindowMs)
  }

  private async runPersistAttempt(): Promise<void> {
    if (this.persistActive || this.retryTimer || this.pendingEntries.length === 0) {
      this.resolveFlushWaitersIfReady()
      return
    }

    this.persistActive = true
    const batch = this.pendingEntries.splice(0, this.pendingEntries.length)
    const mergedUpdate =
      batch.length === 1 ? batch[0].update : Y.mergeUpdates(batch.map((entry) => entry.update))
    const batchSize = batch.length
    const batchBytes = batch.reduce((sum, entry) => sum + entry.bytes, 0)

    try {
      const targetSeq = await this.runStorageTask(() =>
        this.options.repository.appendUpdate(this.options.projectId, mergedUpdate),
      )

      Y.applyUpdate(this.durableDoc, mergedUpdate)
      this.lastDurableSeq = targetSeq
      this.retryAttempt = 0
      this.queuedUpdates = Math.max(0, this.queuedUpdates - batchSize)
      this.queuedBytes = Math.max(0, this.queuedBytes - batchBytes)
      this.committedSinceCompact = true

      this.scheduleProjection(targetSeq)
      this.resetSnapshotTimers()
      this.setState('PERSISTED')

      for (const entry of batch) {
        entry.resolve(targetSeq)
      }

      if (this.queuedUpdates === 0) {
        this.setState('SYNCED')
      } else if (this.hasWritableCapacity()) {
        this.setState('PERSISTING')
      } else {
        this.setState('READ_ONLY')
      }
    } catch (error) {
      this.pendingEntries.unshift(...batch)
      this.setState('DEGRADED')
      if (!this.hasWritableCapacity()) {
        this.setState('READ_ONLY')
      }

      const delayMs = nextRetryDelayMs({
        attempt: this.retryAttempt,
        baseMs: this.config.retryBaseMs,
        maxMs: this.config.retryMaxMs,
        jitterRatio: this.config.retryJitterRatio,
        random: this.random,
      })
      this.retryAttempt += 1
      this.retryTimer = this.clock.setTimeout(() => {
        this.retryTimer = null
        void this.runPersistAttempt()
      }, delayMs)

      this.persistActive = false
      this.resolveFlushWaitersIfReady()
      return
    }

    this.persistActive = false
    this.ensurePersistScheduled()
    this.resolveFlushWaitersIfReady()
  }

  private scheduleProjectionTimer(delayMs: number): void {
    this.clearTimer('projectionTimer')
    this.projectionTimer = this.clock.setTimeout(() => {
      this.projectionTimer = null
      void this.runProjectionAttempt()
    }, delayMs)
  }

  private async runProjectionAttempt(): Promise<void> {
    if (this.projectionStopped || this.projectionActive || !this.pendingProjection) {
      return
    }

    this.projectionActive = true
    const job = this.pendingProjection
    this.pendingProjection = null

    try {
      await this.projector(this.options.projectId, job.payload, job.targetSeq)
    } catch {
      if (!this.projectionStopped) {
        const hasNewerPendingProjection =
          !!this.pendingProjection && this.pendingProjection.targetSeq > job.targetSeq
        const retryJob = hasNewerPendingProjection
          ? this.pendingProjection
          : {
              ...job,
              attempt: job.attempt + 1,
            }

        this.pendingProjection = retryJob
        const delayMs = nextRetryDelayMs({
          attempt: hasNewerPendingProjection ? 0 : job.attempt,
          baseMs: this.config.projectionRetryBaseMs,
          maxMs: this.config.projectionRetryMaxMs,
          jitterRatio: this.config.retryJitterRatio,
          random: this.random,
        })

        this.projectionRetryTimer = this.clock.setTimeout(() => {
          this.projectionRetryTimer = null
          void this.runProjectionAttempt()
        }, delayMs)
      }
    } finally {
      this.projectionActive = false
      if (!this.projectionStopped && this.pendingProjection && !this.projectionRetryTimer) {
        this.scheduleProjectionTimer(this.config.projectionDebounceMs)
      }
    }
  }

  private resetSnapshotTimers(): void {
    if (!this.committedSinceCompact) {
      return
    }

    if (this.config.snapshotIdleMs > 0) {
      this.clearTimer('snapshotIdleTimer')
      this.snapshotIdleTimer = this.clock.setTimeout(() => {
        this.snapshotIdleTimer = null
        void this.compact()
      }, this.config.snapshotIdleMs)
    }

    if (this.config.snapshotIntervalMs > 0) {
      this.clearTimer('snapshotIntervalTimer')
      this.snapshotIntervalTimer = this.clock.setTimeout(() => {
        this.snapshotIntervalTimer = null
        void this.compact()
      }, this.config.snapshotIntervalMs)
    }
  }

  private resolveFlushWaitersIfReady(): void {
    if (!this.isFullyFlushed()) {
      return
    }

    const waiters = this.flushWaiters.splice(0, this.flushWaiters.length)
    for (const waiter of waiters) {
      waiter.resolve()
    }
  }

  private isFullyFlushed(): boolean {
    return (
      this.pendingEntries.length === 0 &&
      this.queuedUpdates === 0 &&
      !this.persistActive &&
      !this.retryTimer &&
      !this.batchTimer
    )
  }

  private hasWritableCapacity(): boolean {
    return (
      this.queuedUpdates < this.config.maxQueuedUpdates &&
      this.queuedBytes < this.config.maxQueuedBytes
    )
  }

  private setState(nextState: ProjectRuntimeState): void {
    if (this.state === nextState) {
      return
    }

    this.state = nextState
    this.onStateChange?.(nextState)
  }

  private clearTimer(
    key:
      | 'batchTimer'
      | 'retryTimer'
      | 'snapshotIdleTimer'
      | 'snapshotIntervalTimer'
      | 'projectionTimer'
      | 'projectionRetryTimer',
  ): void {
    const timer = this[key]
    if (timer) {
      this.clock.clearTimeout(timer)
      this[key] = null
    }
  }

  private async runStorageTask<T>(task: () => Promise<T>): Promise<T> {
    const nextTask = this.storageChain.then(task, task)
    this.storageChain = nextTask.then(
      () => undefined,
      () => undefined,
    )
    return nextTask
  }
}

function createMutationEntry(update: Uint8Array): MutationEntry & { promise: Promise<number> } {
  let resolve!: (seq: number) => void
  let reject!: (error: unknown) => void
  const bytes = byteLength(update)
  const promise = new Promise<number>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {
    update: new Uint8Array(update),
    bytes,
    resolve,
    reject,
    promise,
  }
}

function createDeferredVoid(): DeferredVoid {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { resolve, reject, promise }
}

function nextRetryDelayMs({
  attempt,
  baseMs,
  maxMs,
  jitterRatio,
  random,
}: {
  attempt: number
  baseMs: number
  maxMs: number
  jitterRatio: number
  random: () => number
}): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  const jitter = exponential * Math.max(0, jitterRatio) * clamp01(random())
  return Math.round(exponential + jitter)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function byteLength(update: Uint8Array): number {
  return update.byteLength ?? update.length ?? 0
}

function createSystemClock(): ProjectRuntimeClock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (timer) => clearTimeout(timer),
  }
}

function readIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) ? value : fallback
}

function readFloatEnv(name: string, fallback: number): number {
  const value = Number.parseFloat(process.env[name] ?? '')
  return Number.isFinite(value) ? value : fallback
}
