import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'

import {
  CURRENT_SCHEMA_VERSION,
  createCanvasDocument,
  importLegacyCanvas,
  patchNode,
  readCanvasProjection,
  upsertNode,
} from '../lib/realtime/document'
import {
  YjsRepository,
  type DatabaseAdapter,
  type QueryResult,
} from './yjs-repository'
import type { Queryable } from './db'

type QueryCall = {
  text: string
  params: readonly unknown[]
}

type QueryExpectation = {
  includes: string
  result?: QueryResult<Record<string, unknown>>
  error?: Error
}

class ScriptedDatabaseAdapter implements DatabaseAdapter {
  readonly queryCalls: QueryCall[] = []
  readonly txQueryCalls: QueryCall[] = []

  constructor(
    private readonly script: {
      query?: QueryExpectation[]
      tx?: QueryExpectation[]
    },
  ) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.queryCalls.push({ text, params })
    return this.consume<Row>(this.script.query ?? [], text)
  }

  async transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    const txClient: Queryable = {
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params: readonly unknown[] = [],
      ): Promise<QueryResult<Row>> => {
        this.txQueryCalls.push({ text, params })
        return this.consume<Row>(this.script.tx ?? [], text)
      },
    }

    return work(txClient)
  }

  async close(): Promise<void> {}

  private consume<Row extends Record<string, unknown> = Record<string, unknown>>(
    queue: QueryExpectation[],
    text: string,
  ): QueryResult<Row> {
    const next = queue.shift()
    assert.ok(next, `Unexpected query: ${text}`)

    const actual = normalizeWhitespace(text)
    const expected = normalizeExpected(next.includes)
    assert.ok(
      actual.includes(expected),
      `Expected query to include:\n${expected}\nActual:\n${actual}`,
    )

    if (next.error) throw next.error
    return (next.result ?? { rows: [], rowCount: 0 }) as QueryResult<Row>
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function normalizeExpected(value: string): string {
  return normalizeWhitespace(
    value
      .replaceAll('.*', ' ')
      .replaceAll('\\$', '$')
      .replaceAll('\\(', '(')
      .replaceAll('\\)', ')'),
  )
}

function createHydratedLegacyState() {
  const importedDoc = createCanvasDocument()
  importLegacyCanvas(importedDoc, {
    nodes: [
      {
        id: 'node-1',
        type: 'prompt',
        position: { x: 10, y: 20 },
        data: { label: 'before' },
      },
    ],
    scenes: [
      { id: 'scene-1', name: 'Scene 1' },
      { id: 'scene-2', name: 'Scene 2' },
    ],
    activeSceneId: 'scene-2',
  })

  const snapshot = Y.encodeStateAsUpdate(importedDoc)
  const liveDoc = new Y.Doc()
  Y.applyUpdate(liveDoc, snapshot)

  const updates: Uint8Array[] = []
  liveDoc.on('update', (update) => {
    updates.push(update)
  })

  upsertNode(liveDoc, {
    id: 'node-2',
    type: 'image',
    position: { x: 50, y: 60 },
    data: { label: 'added' },
  })
  patchNode(liveDoc, 'node-1', {
    data: { label: 'after' },
    position: { x: 30, y: 40 },
  })

  return {
    snapshot,
    updates,
    expectedProjection: readCanvasProjection(liveDoc),
  }
}

test('ownsProject constrains ownership by both project id and user id', async () => {
  const database = new ScriptedDatabaseAdapter({
    query: [
      {
        includes: 'select 1 from projects where id = \\$1 and userid = \\$2 limit 1',
        result: { rows: [{ '?column?': 1 }], rowCount: 1 },
      },
    ],
  })
  const repository = new YjsRepository({ database })

  const owns = await repository.ownsProject(
    '550e8400-e29b-41d4-a716-446655440000',
    '00000000-0000-0000-0000-000000000001',
  )

  assert.equal(owns, true)
  assert.deepEqual(database.queryCalls[0]?.params, [
    '550e8400-e29b-41d4-a716-446655440000',
    '00000000-0000-0000-0000-000000000001',
  ])
})

test('loadOrImport hydrates snapshot then ordered updates after snapshot_seq', async () => {
  const { snapshot, updates, expectedProjection } = createHydratedLegacyState()
  const database = new ScriptedDatabaseAdapter({
    tx: [
      {
        includes: 'select pg_advisory_xact_lock',
      },
      {
        includes: 'from canvas_yjs_documents where project_id = $1 for update',
        result: {
          rows: [
            {
              snapshot,
              snapshot_seq: 4,
              durable_seq: 6,
              projected_seq: 5,
              schema_version: CURRENT_SCHEMA_VERSION,
            },
          ],
          rowCount: 1,
        },
      },
      {
        includes:
          'select seq, update_data from canvas_yjs_updates where project_id = \\$1 and seq > \\$2 order by seq asc',
        result: {
          rows: [
            { seq: 5, update_data: Buffer.from(updates[0]) },
            { seq: 6, update_data: Buffer.from(updates[1]) },
          ],
          rowCount: 2,
        },
      },
    ],
  })
  const repository = new YjsRepository({ database })

  const loaded = await repository.loadOrImport('550e8400-e29b-41d4-a716-446655440000')

  assert.equal(loaded.snapshotSeq, 4)
  assert.equal(loaded.durableSeq, 6)
  assert.equal(loaded.projectedSeq, 5)
  assert.deepEqual(readCanvasProjection(loaded.doc), expectedProjection)
  assert.deepEqual(database.txQueryCalls.map((call) => call.params), [
    [repository.advisoryLockNamespace, '550e8400-e29b-41d4-a716-446655440000'],
    ['550e8400-e29b-41d4-a716-446655440000'],
    ['550e8400-e29b-41d4-a716-446655440000', 4],
  ])
})

test('loadOrImport imports legacy canvas exactly once when no durable document exists', async () => {
  const database = new ScriptedDatabaseAdapter({
    tx: [
      { includes: 'select pg_advisory_xact_lock' },
      {
        includes: 'from canvas_yjs_documents where project_id = $1 for update',
        result: { rows: [], rowCount: 0 },
      },
      {
        includes: 'select name, scenes, active_scene_id from projects where id = \\$1',
        result: {
          rows: [
            {
              scenes: [
                { id: 'scene-1', name: 'Scene 1' },
                { id: 'scene-2', name: 'Scene 2' },
              ],
              active_scene_id: 'scene-2',
            },
          ],
          rowCount: 1,
        },
      },
      {
        includes:
          'select nodeid as id, type, position_x, position_y, data from canvas_nodes where projectid = \\$1::text order by createdat asc, nodeid asc',
        result: {
          rows: [
            {
              id: 'node-1',
              type: 'prompt',
              position_x: 25,
              position_y: 35,
              data: { sceneId: 'scene-2' },
            },
          ],
          rowCount: 1,
        },
      },
      {
        includes:
          'select edgeid as id, source, target, sourcehandle, targethandle, animated, data from canvas_edges where projectid = \\$1::text order by createdat asc, edgeid asc',
        result: {
          rows: [
            {
              id: 'edge-1',
              source: 'node-1',
              target: 'node-2',
              sourcehandle: null,
              targethandle: null,
              animated: false,
              data: {},
            },
          ],
          rowCount: 1,
        },
      },
      {
        includes: 'insert into canvas_yjs_documents',
        result: { rows: [], rowCount: 1 },
      },
    ],
  })
  const repository = new YjsRepository({ database })

  const loaded = await repository.loadOrImport('550e8400-e29b-41d4-a716-446655440000')

  assert.equal(loaded.snapshotSeq, 0)
  assert.equal(loaded.durableSeq, 0)
  assert.equal(loaded.projectedSeq, 0)
  assert.deepEqual(readCanvasProjection(loaded.doc), {
    nodes: [
      {
        id: 'node-1',
        type: 'prompt',
        position: { x: 25, y: 35 },
        data: { sceneId: 'scene-2' },
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        sourceHandle: null,
        targetHandle: null,
        animated: false,
        data: {},
      },
    ],
    scenes: [
      { id: 'scene-1', name: 'Scene 1' },
      { id: 'scene-2', name: 'Scene 2' },
    ],
    activeSceneId: 'scene-2',
  })

  const insertCall = database.txQueryCalls.at(-1)
  assert.ok(insertCall)
  assert.equal(insertCall?.params[0], '550e8400-e29b-41d4-a716-446655440000')
  assert.ok(insertCall?.params[1] instanceof Uint8Array)
  assert.equal(insertCall?.params[2], 0)
  assert.equal(insertCall?.params[3], 0)
  assert.equal(insertCall?.params[4], 0)
  assert.equal(insertCall?.params[5], CURRENT_SCHEMA_VERSION)
})

test('appendUpdate serializes on project lock and durable row lock before incrementing sequence', async () => {
  const update = Uint8Array.from([1, 2, 3])
  const database = new ScriptedDatabaseAdapter({
    tx: [
      { includes: 'select pg_advisory_xact_lock' },
      {
        includes: 'select durable_seq from canvas_yjs_documents where project_id = \\$1 for update',
        result: {
          rows: [{ durable_seq: 41 }],
          rowCount: 1,
        },
      },
      {
        includes: 'insert into canvas_yjs_updates \(project_id, seq, update_data\) values \(\\$1, \\$2, \\$3\)',
        result: { rows: [], rowCount: 1 },
      },
      {
        includes: 'update canvas_yjs_documents set durable_seq = \\$2, updated_at = now\(\) where project_id = \\$1',
        result: { rows: [], rowCount: 1 },
      },
    ],
  })
  const repository = new YjsRepository({ database })

  const sequence = await repository.appendUpdate('550e8400-e29b-41d4-a716-446655440000', update)

  assert.equal(sequence, 42)
  assert.deepEqual(database.txQueryCalls.map((call) => call.params), [
    [repository.advisoryLockNamespace, '550e8400-e29b-41d4-a716-446655440000'],
    ['550e8400-e29b-41d4-a716-446655440000'],
    ['550e8400-e29b-41d4-a716-446655440000', 42, update],
    ['550e8400-e29b-41d4-a716-446655440000', 42],
  ])
})

test('compact replaces snapshot metadata and deletes only updates up to included sequence', async () => {
  const database = new ScriptedDatabaseAdapter({
    tx: [
      { includes: 'select pg_advisory_xact_lock' },
      {
        includes: 'select durable_seq from canvas_yjs_documents where project_id = \\$1 for update',
        result: {
          rows: [{ durable_seq: 8 }],
          rowCount: 1,
        },
      },
      {
        includes:
          'update canvas_yjs_documents set snapshot = \\$2, snapshot_seq = \\$3, schema_version = \\$4, updated_at = now\(\) where project_id = \\$1',
        result: { rows: [], rowCount: 1 },
      },
      {
        includes: 'delete from canvas_yjs_updates where project_id = \\$1 and seq <= \\$2',
        result: { rows: [], rowCount: 3 },
      },
    ],
  })
  const repository = new YjsRepository({ database })
  const snapshot = Uint8Array.from([7, 8, 9])

  await repository.compact(
    '550e8400-e29b-41d4-a716-446655440000',
    snapshot,
    6,
    CURRENT_SCHEMA_VERSION,
  )

  assert.deepEqual(database.txQueryCalls.map((call) => call.params), [
    [repository.advisoryLockNamespace, '550e8400-e29b-41d4-a716-446655440000'],
    ['550e8400-e29b-41d4-a716-446655440000'],
    ['550e8400-e29b-41d4-a716-446655440000', snapshot, 6, CURRENT_SCHEMA_VERSION],
    ['550e8400-e29b-41d4-a716-446655440000', 6],
  ])
})

test('loadProjectionLag returns lagging projects ordered by largest lag first', async () => {
  const database = new ScriptedDatabaseAdapter({
    query: [
      {
        includes:
          'select project_id, durable_seq, projected_seq, durable_seq - projected_seq as lag from canvas_yjs_documents where projected_seq < durable_seq order by lag desc, project_id asc',
        result: {
          rows: [
            {
              project_id: '550e8400-e29b-41d4-a716-446655440001',
              durable_seq: '9',
              projected_seq: '3',
              lag: '6',
            },
            {
              project_id: '550e8400-e29b-41d4-a716-446655440000',
              durable_seq: 5,
              projected_seq: 4,
              lag: 1,
            },
          ],
          rowCount: 2,
        },
      },
    ],
  })
  const repository = new YjsRepository({ database })

  const laggingProjects = await repository.loadProjectionLag()

  assert.deepEqual(laggingProjects, [
    {
      projectId: '550e8400-e29b-41d4-a716-446655440001',
      durableSeq: 9,
      projectedSeq: 3,
      lag: 6,
    },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      durableSeq: 5,
      projectedSeq: 4,
      lag: 1,
    },
  ])
})

test('existing durable documents do not query legacy compatibility tables during hydration', async () => {
  const doc = createCanvasDocument()
  const snapshot = Y.encodeStateAsUpdate(doc)
  const database = new ScriptedDatabaseAdapter({
    tx: [
      { includes: 'select pg_advisory_xact_lock' },
      {
        includes: 'from canvas_yjs_documents where project_id = $1 for update',
        result: {
          rows: [
            {
              snapshot,
              snapshot_seq: 0,
              durable_seq: 0,
              projected_seq: 0,
              schema_version: CURRENT_SCHEMA_VERSION,
            },
          ],
          rowCount: 1,
        },
      },
      {
        includes:
          'select seq, update_data from canvas_yjs_updates where project_id = \\$1 and seq > \\$2 order by seq asc',
        result: { rows: [], rowCount: 0 },
      },
    ],
  })
  const repository = new YjsRepository({ database })

  await repository.loadOrImport('550e8400-e29b-41d4-a716-446655440000')

  const normalized = database.txQueryCalls.map((call) => normalizeWhitespace(call.text))
  assert.equal(normalized.some((sql) => sql.includes('from canvas_nodes')), false)
  assert.equal(normalized.some((sql) => sql.includes('from canvas_edges')), false)
  assert.equal(normalized.some((sql) => sql.includes('select name, scenes, active_scene_id from projects')), false)
})
