import { fileURLToPath } from 'node:url'

import { Server, type onAuthenticatePayload, type onRequestPayload } from '@hocuspocus/server'
import * as Y from 'yjs'

import { parseProjectDocumentName } from '../lib/realtime/document'
import { verifyRealtimeToken } from './auth'
import { createDatabaseAdapter, type DatabaseAdapter } from './db'
import {
  verifyCanvasAuthorization,
  type CanvasAuthorizationPayload,
} from './internal-auth'
import { ProjectRuntime } from './project-runtime'
import { YjsRepository } from './yjs-repository'

type RealtimeEnvironment = {
  REALTIME_TOKEN_SECRET?: string
  CANVAS_AUTH_SECRET?: string
  PORT?: string
  HOST?: string
}

type LoadedProjectDocument = Awaited<ReturnType<YjsRepository['loadOrImport']>>

type RealtimeRepository = Pick<
  YjsRepository,
  'ownsProject' | 'loadOrImport' | 'appendUpdate' | 'compact' | 'close'
>

type RealtimeRuntime = Pick<ProjectRuntime, 'enqueue'>

type RuntimeFactory = (options: {
  projectId: string
  doc: Y.Doc
  repository: RealtimeRepository
  loaded: LoadedProjectDocument
}) => RealtimeRuntime

type ConnectionContext = {
  projectId: string
  userId: string
}

type RoomState = {
  projectId: string
  doc: Y.Doc
  runtime: RealtimeRuntime
}

export type RealtimeServerEvent = {
  type:
    | 'http:authorize'
    | 'http:authorize:granted'
    | 'http:authorize:denied'
    | 'ws:authorized'
    | 'ws:load-document'
    | 'ws:before-sync'
    | 'ws:change'
    | 'ws:disconnect'
  projectId?: string
  userId?: string
  socketId?: string
}

export type RealtimeServerOptions = {
  address?: string
  port?: number
  quiet?: boolean
  env?: RealtimeEnvironment
  repository?: RealtimeRepository
  database?: DatabaseAdapter
  verifyToken?: typeof verifyRealtimeToken
  verifyCanvasRequest?: typeof verifyCanvasAuthorization
  createRuntime?: RuntimeFactory
  onEvent?: (event: RealtimeServerEvent) => void
}

export type RealtimeServerHandle = {
  listen(port?: number): Promise<void>
  destroy(): Promise<void>
  readonly httpUrl: string
  readonly wsUrl: string
  getConnectionCount(): number
}

const DEFAULT_ADDRESS = '127.0.0.1'
const NONCE_TTL_SECONDS = 60
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

export function createRealtimeServer(options: RealtimeServerOptions = {}): RealtimeServerHandle {
  const env: RealtimeEnvironment = {
    ...process.env,
    ...options.env,
  }
  const database = options.database ?? createDatabaseAdapter()
  const repository = options.repository ?? new YjsRepository({ database })
  const ownsRepository = !options.repository
  const ownsDatabase = !options.database && !!options.repository
  const verifyToken = options.verifyToken ?? verifyRealtimeToken
  const verifyCanvasRequest = options.verifyCanvasRequest ?? verifyCanvasAuthorization
  const emit = options.onEvent ?? (() => {})
  const connectionContexts = new Map<string, ConnectionContext>()
  const rooms = new Map<string, RoomState>()

  const hocuspocusServer = new Server<ConnectionContext>({
    address: options.address ?? env.HOST ?? DEFAULT_ADDRESS,
    port: options.port,
    quiet: options.quiet ?? true,
    stopOnSignals: false,
    onRequest: async (payload) => {
      if (await handleHttpRequest(payload, { env, database, verifyCanvasRequest, emit })) {
        throw undefined
      }
    },
    onAuthenticate: async (payload) => {
      const context = await authenticateConnection(payload, {
        env,
        repository,
        verifyToken,
        emit,
      })
      connectionContexts.set(payload.socketId, context)
      emit({
        type: 'ws:authorized',
        projectId: context.projectId,
        userId: context.userId,
        socketId: payload.socketId,
      })
      return context
    },
    onLoadDocument: async (payload) => {
      const context = requireConnectionContext(payload.socketId, connectionContexts, payload.documentName)
      emit({
        type: 'ws:load-document',
        projectId: context.projectId,
        userId: context.userId,
        socketId: payload.socketId,
      })

      const existingRoom = rooms.get(context.projectId)
      if (existingRoom) {
        return existingRoom.doc
      }

      const loaded = await repository.loadOrImport(context.projectId)
      const runtime = (options.createRuntime ?? createProjectRuntime)({
        projectId: context.projectId,
        doc: loaded.doc,
        repository,
        loaded,
      })

      rooms.set(context.projectId, {
        projectId: context.projectId,
        doc: loaded.doc,
        runtime,
      })

      return loaded.doc
    },
    beforeSync: async (payload) => {
      const context = requireDocumentContext(payload.documentName, payload.context)
      emit({
        type: 'ws:before-sync',
        projectId: context.projectId,
        userId: context.userId,
      })
    },
    onChange: async (payload) => {
      const context = requireDocumentContext(payload.documentName, payload.context)
      const room = rooms.get(context.projectId)
      if (!room) {
        throw new Error(`Missing realtime room for ${context.projectId}`)
      }

      emit({
        type: 'ws:change',
        projectId: context.projectId,
        userId: context.userId,
        socketId: payload.socketId,
      })

      await room.runtime.enqueue(new Uint8Array(payload.update))
    },
    onDisconnect: async (payload) => {
      const context = connectionContexts.get(payload.socketId)
      connectionContexts.delete(payload.socketId)
      emit({
        type: 'ws:disconnect',
        projectId: context?.projectId,
        userId: context?.userId,
        socketId: payload.socketId,
      })
    },
    afterUnloadDocument: async ({ documentName }) => {
      try {
        const projectId = parseProjectDocumentName(documentName)
        rooms.delete(projectId)
      } catch {
        // Ignore malformed names after Hocuspocus teardown.
      }
    },
  })

  return {
    async listen(port?: number): Promise<void> {
      await hocuspocusServer.listen(port ?? options.port ?? readPort(env.PORT))
    },

    async destroy(): Promise<void> {
      await hocuspocusServer.destroy()

      if (ownsRepository) {
        await repository.close()
      } else if (ownsDatabase) {
        await database.close()
      }
    },

    get httpUrl(): string {
      return `http://127.0.0.1:${hocuspocusServer.address.port}`
    },

    get wsUrl(): string {
      return `ws://127.0.0.1:${hocuspocusServer.address.port}`
    },

    getConnectionCount(): number {
      return connectionContexts.size
    },
  }
}

function createProjectRuntime({ projectId, doc, repository }: Parameters<RuntimeFactory>[0]): RealtimeRuntime {
  return new ProjectRuntime({
    projectId,
    doc,
    repository,
  })
}

async function handleHttpRequest(
  payload: onRequestPayload,
  {
    env,
    database,
    verifyCanvasRequest,
    emit,
  }: {
    env: RealtimeEnvironment
    database: DatabaseAdapter
    verifyCanvasRequest: typeof verifyCanvasAuthorization
    emit: (event: RealtimeServerEvent) => void
  },
): Promise<boolean> {
  const requestUrl = new URL(payload.request.url ?? '/', 'http://127.0.0.1')

  if (payload.request.method === 'GET' && requestUrl.pathname === '/healthz') {
    writeJson(payload.response, 200, { ok: true })
    return true
  }

  if (requestUrl.pathname !== '/internal/authorize') {
    return false
  }

  if (payload.request.method !== 'POST') {
    writeJson(payload.response, 405, { authorized: false })
    return true
  }

  const body = await readJsonBody(payload.request)
  if (!body) {
    writeJson(payload.response, 400, { authorized: false })
    return true
  }

  const authorizationPayload = {
    userId: body.userId,
    projectId: body.projectId,
    timestamp: body.timestamp,
    nonce: body.nonce,
  }

  emit({
    type: 'http:authorize',
    projectId: stringOrUndefined(body.projectId),
    userId: stringOrUndefined(body.userId),
  })

  if (
    !verifyCanvasRequest(
      authorizationPayload as CanvasAuthorizationPayload,
      typeof body.signature === 'string' ? body.signature : '',
      env.CANVAS_AUTH_SECRET ?? '',
    )
  ) {
    writeJson(payload.response, 403, { authorized: false })
    emit({ type: 'http:authorize:denied' })
    return true
  }

  const allowed = await authorizeCanvasRequest({
    database,
    payload: authorizationPayload as CanvasAuthorizationPayload,
  })

  if (!allowed) {
    writeJson(payload.response, 403, { authorized: false })
    emit({
      type: 'http:authorize:denied',
      projectId: stringOrUndefined(authorizationPayload.projectId),
      userId: stringOrUndefined(authorizationPayload.userId),
    })
    return true
  }

  writeJson(payload.response, 200, { authorized: true })
  emit({
    type: 'http:authorize:granted',
    projectId: stringOrUndefined(authorizationPayload.projectId),
    userId: stringOrUndefined(authorizationPayload.userId),
  })
  return true
}

async function authenticateConnection(
  payload: onAuthenticatePayload<ConnectionContext>,
  {
    env,
    repository,
    verifyToken,
    emit,
  }: {
    env: RealtimeEnvironment
    repository: RealtimeRepository
    verifyToken: typeof verifyRealtimeToken
    emit: (event: RealtimeServerEvent) => void
  },
): Promise<ConnectionContext> {
  const projectId = parseProjectDocumentName(payload.documentName)
  const claims = await verifyToken(payload.token, projectId, env.REALTIME_TOKEN_SECRET ?? '')

  if (!claims) {
    throw forbidden('invalid token')
  }

  const ownsProject = await repository.ownsProject(projectId, claims.userId)
  if (!ownsProject) {
    throw forbidden('project access denied')
  }

  return {
    projectId,
    userId: claims.userId,
  }
}

async function authorizeCanvasRequest({
  database,
  payload,
}: {
  database: DatabaseAdapter
  payload: CanvasAuthorizationPayload
}): Promise<boolean> {
  try {
    return await database.transaction(async (tx) => {
      await tx.query(
        `
          INSERT INTO canvas_auth_nonces (nonce, created_at, expires_at)
          VALUES ($1, NOW(), to_timestamp($2) + INTERVAL '1 second' * $3)
        `,
        [payload.nonce, payload.timestamp, NONCE_TTL_SECONDS],
      )

      const result = await tx.query(
        `SELECT 1 FROM projects WHERE id = $1 AND userid = $2 LIMIT 1`,
        [payload.projectId, payload.userId],
      )

      return result.rows.length > 0
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return false
    }
    throw error
  }
}

function requireConnectionContext(
  socketId: string,
  connectionContexts: Map<string, ConnectionContext>,
  documentName: string,
): ConnectionContext {
  const context = connectionContexts.get(socketId)
  if (!context) {
    throw forbidden(`missing connection context for ${documentName}`)
  }
  return context
}

function requireDocumentContext(
  documentName: string,
  context: ConnectionContext | undefined,
): ConnectionContext {
  if (!context) {
    throw forbidden(`missing document context for ${documentName}`)
  }

  const projectId = parseProjectDocumentName(documentName)
  if (context.projectId !== projectId) {
    throw forbidden(`document context mismatch for ${documentName}`)
  }

  return context
}

async function readJsonBody(request: onRequestPayload['request']): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return null
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function writeJson(response: onRequestPayload['response'], status: number, body: Record<string, unknown>): void {
  response.writeHead(status, JSON_HEADERS)
  response.end(JSON.stringify(body))
}

function isUniqueViolation(error: unknown): error is Error & { code: string } {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505'
}

function forbidden(reason: string): Error & { reason: string } {
  const error = new Error(reason) as Error & { reason: string }
  error.reason = reason
  return error
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readPort(value: string | undefined): number | undefined {
  const port = Number.parseInt(value ?? '', 10)
  return Number.isFinite(port) ? port : undefined
}

async function startFromCli(): Promise<void> {
  const server = createRealtimeServer()
  await server.listen()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void startFromCli()
}
