import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'

import { createCanvasDocument, importLegacyCanvas, patchNode } from '../lib/realtime/document'
import { projectDocument } from './projector'
import type { DatabaseAdapter, QueryResult } from './db'
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

  constructor(private readonly script: QueryExpectation[]) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.queryCalls.push({ text, params })
    return this.consume<Row>(text)
  }

  async transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
    const txClient: Queryable = {
      query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        params: readonly unknown[] = [],
      ): Promise<QueryResult<Row>> => {
        this.txQueryCalls.push({ text, params })
        return this.consume<Row>(text)
      },
    }

    return work(txClient)
  }

  async close(): Promise<void> {}

  private consume<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
  ): QueryResult<Row> {
    const next = this.script.shift()
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

function createProjectionDocument(): Y.Doc {
  const doc = createCanvasDocument()
  importLegacyCanvas(doc, {
    nodes: [
      {
        id: 'node-1',
        type: 'prompt',
        position: { x: 10, y: 20 },
        data: { label: 'Prompt', sceneId: 'scene-2' },
      },
      {
        id: 'node-2',
        type: 'image',
        position: { x: 30, y: 40 },
        data: { label: 'Image', assetId: 'asset-1' },
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        sourceHandle: 'out',
        targetHandle: 'in',
        animated: true,
        data: { label: 'flow' },
      },
    ],
    scenes: [
      { id: 'scene-1', name: 'Scene 1' },
      { id: 'scene-2', name: 'Scene 2' },
    ],
    activeSceneId: 'scene-2',
  })
  return doc
}

function createProjectionTrapDocument(message: string): Y.Doc {
  const doc = createProjectionDocument()
  Object.defineProperty(doc, 'getMap', {
    configurable: true,
    value: () => {
      throw new Error(message)
    },
  })
  return doc
}

test('projectDocument rewrites compatibility tables, project metadata, and projected_seq in one transaction', async () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000'
  const doc = createProjectionDocument()
  const database = new ScriptedDatabaseAdapter([
    { includes: 'select pg_advisory_xact_lock' },
    {
      includes:
        'select durable_seq, projected_seq from canvas_yjs_documents where project_id = \\$1 for update',
      result: {
        rows: [{ durable_seq: 9, projected_seq: 4 }],
        rowCount: 1,
      },
    },
    {
      includes: 'delete from canvas_nodes where projectid = \\$1::text',
      result: { rows: [], rowCount: 2 },
    },
    {
      includes: 'delete from canvas_edges where projectid = \\$1::text',
      result: { rows: [], rowCount: 1 },
    },
    {
      includes:
        'insert into canvas_nodes \(projectid, nodeid, type, position_x, position_y, data\) values \(\\$1::text, \\$2, \\$3, \\$4, \\$5, \\$6::jsonb\) on conflict \(projectid, nodeid\) do update set',
      result: { rows: [], rowCount: 1 },
    },
    {
      includes:
        'insert into canvas_nodes \(projectid, nodeid, type, position_x, position_y, data\) values \(\\$1::text, \\$2, \\$3, \\$4, \\$5, \\$6::jsonb\) on conflict \(projectid, nodeid\) do update set',
      result: { rows: [], rowCount: 1 },
    },
    {
      includes:
        'insert into canvas_edges \(projectid, edgeid, source, target, sourcehandle, targethandle, animated, data\) values \(\\$1::text, \\$2, \\$3, \\$4, \\$5, \\$6, \\$7, \\$8::jsonb\) on conflict \(projectid, edgeid\) do update set',
      result: { rows: [], rowCount: 1 },
    },
    {
      includes:
        'update projects set updatedat = now\(\), scenes = \\$2::jsonb, active_scene_id = \\$3 where id = \\$1',
      result: { rows: [], rowCount: 1 },
    },
    {
      includes:
        'update canvas_yjs_documents set projected_seq = \\$2, updated_at = now\(\) where project_id = \\$1',
      result: { rows: [], rowCount: 1 },
    },
  ])

  await projectDocument(projectId, doc, 9, { database })

  assert.deepEqual(database.queryCalls, [])
  assert.deepEqual(database.txQueryCalls.map((call) => call.params), [
    [0x53504954, projectId],
    [projectId],
    [projectId],
    [projectId],
    [projectId, 'node-1', 'prompt', 10, 20, JSON.stringify({ label: 'Prompt', sceneId: 'scene-2' })],
    [projectId, 'node-2', 'image', 30, 40, JSON.stringify({ label: 'Image', assetId: 'asset-1' })],
    [projectId, 'edge-1', 'node-1', 'node-2', 'out', 'in', true, JSON.stringify({ label: 'flow' })],
    [
      projectId,
      JSON.stringify([
        { id: 'scene-1', name: 'Scene 1' },
        { id: 'scene-2', name: 'Scene 2' },
      ]),
      'scene-2',
    ],
    [projectId, 9],
  ])

  assert.match(
    normalizeWhitespace(database.txQueryCalls.at(-1)?.text ?? ''),
    /update canvas_yjs_documents set projected_seq = \$2, updated_at = now\(\) where project_id = \$1/,
  )
})

test('projectDocument no-ops for stale target sequences before deriving a projection payload', async () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000'
  const database = new ScriptedDatabaseAdapter([
    { includes: 'select pg_advisory_xact_lock' },
    {
      includes:
        'select durable_seq, projected_seq from canvas_yjs_documents where project_id = \\$1 for update',
      result: {
        rows: [{ durable_seq: 9, projected_seq: 9 }],
        rowCount: 1,
      },
    },
  ])

  await projectDocument(
    projectId,
    createProjectionTrapDocument('stale target should not derive projection'),
    9,
    { database },
  )

  assert.equal(database.txQueryCalls.length, 2)
  assert.equal(
    database.txQueryCalls.some((call) =>
      normalizeWhitespace(call.text).includes('update canvas_yjs_documents set projected_seq'),
    ),
    false,
  )
})

test('projectDocument rejects future target sequences before deriving a projection payload', async () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000'
  const database = new ScriptedDatabaseAdapter([
    { includes: 'select pg_advisory_xact_lock' },
    {
      includes:
        'select durable_seq, projected_seq from canvas_yjs_documents where project_id = \\$1 for update',
      result: {
        rows: [{ durable_seq: 9, projected_seq: 4 }],
        rowCount: 1,
      },
    },
  ])

  await assert.rejects(
    projectDocument(
      projectId,
      createProjectionTrapDocument('future target should not derive projection'),
      10,
      { database },
    ),
    /cannot project .* beyond durable sequence 9/i,
  )

  assert.equal(database.txQueryCalls.length, 2)
})

test('projectDocument rejects non-durable boundary targets before deriving a projection payload', async () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000'
  const database = new ScriptedDatabaseAdapter([
    { includes: 'select pg_advisory_xact_lock' },
    {
      includes:
        'select durable_seq, projected_seq from canvas_yjs_documents where project_id = \\$1 for update',
      result: {
        rows: [{ durable_seq: 9, projected_seq: 4 }],
        rowCount: 1,
      },
    },
  ])

  await assert.rejects(
    projectDocument(
      projectId,
      createProjectionTrapDocument('non-durable boundary target should not derive projection'),
      8,
      { database },
    ),
    /must equal durable sequence 9/i,
  )

  assert.equal(database.txQueryCalls.length, 2)
})

test('projectDocument captures projection only after lock and sequence boundary validation', async () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000'
  const doc = createProjectionDocument()
  const txQueryCalls: QueryCall[] = []
  let releaseLock!: () => void
  let resolveLockRequested!: () => void
  const lockRequested = new Promise<void>((resolve) => {
    resolveLockRequested = resolve
  })
  const database: DatabaseAdapter = {
    async query() {
      throw new Error('unexpected non-transaction query')
    },
    async transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
      let queryIndex = 0
      const txClient: Queryable = {
        query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
          text: string,
          params: readonly unknown[] = [],
        ): Promise<QueryResult<Row>> => {
          txQueryCalls.push({ text, params })
          queryIndex += 1

          if (queryIndex === 1) {
            resolveLockRequested()
            await new Promise<void>((resolve) => {
              releaseLock = resolve
            })
            return { rows: [], rowCount: 0 } as QueryResult<Row>
          }

          if (queryIndex === 2) {
            return {
              rows: [{ durable_seq: 9, projected_seq: 4 }],
              rowCount: 1,
            } as unknown as QueryResult<Row>
          }

          return { rows: [], rowCount: 1 } as QueryResult<Row>
        },
      }

      return work(txClient)
    },
    async close(): Promise<void> {},
  }

  const projectionPromise = projectDocument(projectId, doc, 9, { database })
  await lockRequested

  patchNode(doc, 'node-2', {
    position: { x: 300, y: 400 },
    data: { label: 'Image v2', assetId: 'asset-2' },
  })
  releaseLock()

  await projectionPromise

  assert.deepEqual(
    txQueryCalls.find(
      (call) =>
        normalizeWhitespace(call.text).includes('insert into canvas_nodes') &&
        call.params[1] === 'node-2',
    )?.params,
    [
      projectId,
      'node-2',
      'image',
      300,
      400,
      JSON.stringify({ label: 'Image v2', assetId: 'asset-2' }),
    ],
  )
})

test('projectDocument never mutates the input Y.Doc while projecting', async () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000'
  const doc = createProjectionDocument()
  const before = Buffer.from(Y.encodeStateAsUpdate(doc))
  const database = new ScriptedDatabaseAdapter([
    { includes: 'select pg_advisory_xact_lock' },
    {
      includes:
        'select durable_seq, projected_seq from canvas_yjs_documents where project_id = \\$1 for update',
      result: {
        rows: [{ durable_seq: 5, projected_seq: 1 }],
        rowCount: 1,
      },
    },
    { includes: 'delete from canvas_nodes where projectid = \\$1::text' },
    { includes: 'delete from canvas_edges where projectid = \\$1::text' },
    { includes: 'insert into canvas_nodes' },
    { includes: 'insert into canvas_nodes' },
    { includes: 'insert into canvas_edges' },
    { includes: 'update projects set updatedat = now\(\), scenes = \\$2::jsonb, active_scene_id = \\$3 where id = \\$1' },
    { includes: 'update canvas_yjs_documents set projected_seq = \\$2, updated_at = now\(\) where project_id = \\$1' },
  ])

  await projectDocument(projectId, doc, 5, { database })

  const after = Buffer.from(Y.encodeStateAsUpdate(doc))
  assert.deepEqual(after, before)
})

test('projectDocument never advances projected_seq when compatibility projection fails', async () => {
  const projectId = '550e8400-e29b-41d4-a716-446655440000'
  const database = new ScriptedDatabaseAdapter([
    { includes: 'select pg_advisory_xact_lock' },
    {
      includes:
        'select durable_seq, projected_seq from canvas_yjs_documents where project_id = \\$1 for update',
      result: {
        rows: [{ durable_seq: 9, projected_seq: 4 }],
        rowCount: 1,
      },
    },
    { includes: 'delete from canvas_nodes where projectid = \\$1::text' },
    { includes: 'delete from canvas_edges where projectid = \\$1::text' },
    { includes: 'insert into canvas_nodes' },
    { includes: 'insert into canvas_nodes' },
    { includes: 'insert into canvas_edges' },
    {
      includes:
        'update projects set updatedat = now\(\), scenes = \\$2::jsonb, active_scene_id = \\$3 where id = \\$1',
      error: new Error('forced projection failure'),
    },
  ])

  await assert.rejects(
    projectDocument(projectId, createProjectionDocument(), 9, { database }),
    /forced projection failure/,
  )

  assert.equal(
    database.txQueryCalls.some((call) =>
      normalizeWhitespace(call.text).includes('update canvas_yjs_documents set projected_seq'),
    ),
    false,
  )
})
