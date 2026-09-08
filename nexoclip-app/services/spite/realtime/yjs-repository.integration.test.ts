import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { Pool } from '@neondatabase/serverless'
import * as Y from 'yjs'

import {
  CURRENT_SCHEMA_VERSION,
  patchNode,
  readCanvasProjection,
  upsertNode,
} from '../lib/realtime/document'
import { applyRealtimeSchema } from '../scripts/migrate-realtime.mjs'
import { createDatabaseAdapter, type DatabaseAdapter } from './db'
import { YjsRepository } from './yjs-repository'

const databaseUrl = process.env.SPITE_TEST_DATABASE_URL
const integrationSkip = databaseUrl ? undefined : 'SPITE_TEST_DATABASE_URL is not set'

type IntegrationContext = {
  pool: Pool
  repository: YjsRepository
  projectIds: string[]
}

function integrationTest(
  name: string,
  fn: (context: IntegrationContext) => Promise<void>,
): void {
  test(name, { skip: integrationSkip }, async () => {
    assert.ok(databaseUrl)
    await applyRealtimeSchema({ databaseUrl })

    const pool = new Pool({ connectionString: databaseUrl })
    const repository = new YjsRepository({
      database: createDatabaseAdapter({ pool, ownsPool: false }),
    })
    const projectIds: string[] = []

    try {
      await fn({ pool, repository, projectIds })
    } finally {
      for (const projectId of projectIds.reverse()) {
        await pool.query('DELETE FROM projects WHERE id = $1', [projectId])
      }
      await pool.end()
    }
  })
}

integrationTest('concurrent appends allocate contiguous durable sequences per project', async ({
  pool,
  repository,
  projectIds,
}) => {
  const projectId = await createProject(pool)
  projectIds.push(projectId)

  const loaded = await repository.loadOrImport(projectId)
  const updates = Array.from({ length: 6 }, (_, index) =>
    captureUpdate(loaded.doc, () => {
      upsertNode(loaded.doc, {
        id: `node-${index + 1}`,
        type: 'prompt',
        position: { x: index * 10, y: index * 20 },
        data: { order: index + 1 },
      })
    }),
  )

  const sequences = await Promise.all(updates.map((update) => repository.appendUpdate(projectId, update)))
  const sortedSequences = [...sequences].sort((a, b) => a - b)

  assert.deepEqual(sortedSequences, [1, 2, 3, 4, 5, 6])

  const updatesResult = await pool.query<{ seq: string }>(
    'SELECT seq FROM canvas_yjs_updates WHERE project_id = $1 ORDER BY seq ASC',
    [projectId],
  )
  assert.deepEqual(
    updatesResult.rows.map((row) => Number(row.seq)),
    [1, 2, 3, 4, 5, 6],
  )

  const documentResult = await pool.query<{ durable_seq: string }>(
    'SELECT durable_seq FROM canvas_yjs_documents WHERE project_id = $1',
    [projectId],
  )
  assert.equal(Number(documentResult.rows[0]?.durable_seq ?? 0), 6)
})

integrationTest('different projects keep independent durable counters', async ({ pool, repository, projectIds }) => {
  const projectA = await createProject(pool)
  const projectB = await createProject(pool)
  projectIds.push(projectA, projectB)

  const [loadedA, loadedB] = await Promise.all([
    repository.loadOrImport(projectA),
    repository.loadOrImport(projectB),
  ])

  const [sequenceA, sequenceB] = await Promise.all([
    repository.appendUpdate(
      projectA,
      captureUpdate(loadedA.doc, () => {
        upsertNode(loadedA.doc, {
          id: 'node-a',
          type: 'prompt',
          position: { x: 1, y: 2 },
          data: { label: 'A' },
        })
      }),
    ),
    repository.appendUpdate(
      projectB,
      captureUpdate(loadedB.doc, () => {
        upsertNode(loadedB.doc, {
          id: 'node-b',
          type: 'prompt',
          position: { x: 3, y: 4 },
          data: { label: 'B' },
        })
      }),
    ),
  ])

  assert.equal(sequenceA, 1)
  assert.equal(sequenceB, 1)

  const rows = await pool.query<{ project_id: string; durable_seq: string }>(
    `
      SELECT project_id, durable_seq
      FROM canvas_yjs_documents
      WHERE project_id = ANY($1::uuid[])
      ORDER BY project_id ASC
    `,
    [[projectA, projectB]],
  )

  assert.deepEqual(
    rows.rows.map((row) => ({ projectId: row.project_id, durableSeq: Number(row.durable_seq) })),
    [
      { projectId: projectA, durableSeq: 1 },
      { projectId: projectB, durableSeq: 1 },
    ].sort((left, right) => left.projectId.localeCompare(right.projectId)),
  )
})

integrationTest('failed append transactions roll back inserted updates and durable sequence changes', async ({
  pool,
  repository,
  projectIds,
}) => {
  const projectId = await createProject(pool)
  projectIds.push(projectId)

  const loaded = await repository.loadOrImport(projectId)
  const update = captureUpdate(loaded.doc, () => {
    upsertNode(loaded.doc, {
      id: 'node-1',
      type: 'prompt',
      position: { x: 10, y: 20 },
      data: { label: 'rollback' },
    })
  })

  const baseDatabase = createDatabaseAdapter({ pool, ownsPool: false })
  const failingDatabase: DatabaseAdapter = {
    query: (...args) => baseDatabase.query(...args),
    close: async () => {},
    async transaction(work) {
      return baseDatabase.transaction((tx) =>
        work({
          query: async (text, params = []) => {
            if (normalizeWhitespace(text).includes('update canvas_yjs_documents set durable_seq')) {
              throw new Error('forced append failure')
            }
            return tx.query(text, params)
          },
        }),
      )
    },
  }
  const failingRepository = new YjsRepository({ database: failingDatabase })

  await assert.rejects(
    failingRepository.appendUpdate(projectId, update),
    /forced append failure/,
  )

  const documentResult = await pool.query<{ durable_seq: string }>(
    'SELECT durable_seq FROM canvas_yjs_documents WHERE project_id = $1',
    [projectId],
  )
  const updatesResult = await pool.query<{ seq: string }>(
    'SELECT seq FROM canvas_yjs_updates WHERE project_id = $1',
    [projectId],
  )

  assert.equal(Number(documentResult.rows[0]?.durable_seq ?? 0), 0)
  assert.equal(updatesResult.rows.length, 0)
})

integrationTest('concurrent first hydration imports legacy canvas exactly once', async ({
  pool,
  repository,
  projectIds,
}) => {
  const projectId = await createProject(pool, {
    scenes: [
      { id: 'scene-1', name: 'Scene 1' },
      { id: 'scene-2', name: 'Scene 2' },
    ],
    activeSceneId: 'scene-2',
    legacyNodes: [
      {
        id: 'node-1',
        type: 'prompt',
        positionX: 20,
        positionY: 30,
        data: { sceneId: 'scene-2', label: 'legacy' },
      },
    ],
    legacyEdges: [
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
  })
  projectIds.push(projectId)

  const loads = await Promise.all([
    repository.loadOrImport(projectId),
    repository.loadOrImport(projectId),
    repository.loadOrImport(projectId),
  ])

  const expectedProjection = {
    nodes: [
      {
        id: 'node-1',
        type: 'prompt',
        position: { x: 20, y: 30 },
        data: { sceneId: 'scene-2', label: 'legacy' },
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
  }

  for (const loaded of loads) {
    assert.deepEqual(readCanvasProjection(loaded.doc), expectedProjection)
    assert.equal(loaded.snapshotSeq, 0)
    assert.equal(loaded.durableSeq, 0)
  }

  const countResult = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::int AS count FROM canvas_yjs_documents WHERE project_id = $1',
    [projectId],
  )
  const updateCountResult = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::int AS count FROM canvas_yjs_updates WHERE project_id = $1',
    [projectId],
  )

  assert.equal(Number(countResult.rows[0]?.count ?? 0), 1)
  assert.equal(Number(updateCountResult.rows[0]?.count ?? 0), 0)
})

integrationTest('snapshot plus ordered updates reconstruct the same Yjs projection after compaction', async ({
  pool,
  repository,
  projectIds,
}) => {
  const projectId = await createProject(pool)
  projectIds.push(projectId)

  const loaded = await repository.loadOrImport(projectId)

  const updateOne = captureUpdate(loaded.doc, () => {
    upsertNode(loaded.doc, {
      id: 'node-1',
      type: 'prompt',
      position: { x: 10, y: 15 },
      data: { label: 'one' },
    })
  })
  await repository.appendUpdate(projectId, updateOne)

  const updateTwo = captureUpdate(loaded.doc, () => {
    patchNode(loaded.doc, 'node-1', {
      position: { x: 99, y: 101 },
      data: { label: 'two' },
    })
  })
  await repository.appendUpdate(projectId, updateTwo)

  await repository.compact(
    projectId,
    Y.encodeStateAsUpdate(loaded.doc),
    2,
    CURRENT_SCHEMA_VERSION,
  )

  const updateThree = captureUpdate(loaded.doc, () => {
    upsertNode(loaded.doc, {
      id: 'node-2',
      type: 'image',
      position: { x: 5, y: 6 },
      data: { label: 'three' },
    })
  })
  await repository.appendUpdate(projectId, updateThree)

  const hydrated = await repository.loadOrImport(projectId)

  assert.equal(hydrated.snapshotSeq, 2)
  assert.equal(hydrated.durableSeq, 3)
  assert.deepEqual(readCanvasProjection(hydrated.doc), readCanvasProjection(loaded.doc))
})

function captureUpdate(doc: Y.Doc, mutate: () => void): Uint8Array {
  const updates: Uint8Array[] = []
  const handler = (update: Uint8Array) => {
    updates.push(update)
  }

  doc.on('update', handler)
  mutate()
  doc.off('update', handler)

  assert.ok(updates.length > 0, 'Expected mutation to emit at least one update')
  return updates.length === 1 ? updates[0] : Y.mergeUpdates(updates)
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

async function createProject(
  pool: Pool,
  {
    userId = randomUUID(),
    scenes = [{ id: 'scene-1', name: 'Scene 1' }],
    activeSceneId = 'scene-1',
    legacyNodes = [],
    legacyEdges = [],
  }: {
    userId?: string
    scenes?: Array<{ id: string; name: string }>
    activeSceneId?: string | null
    legacyNodes?: Array<{
      id: string
      type: string
      positionX: number
      positionY: number
      data: Record<string, unknown>
    }>
    legacyEdges?: Array<{
      id: string
      source: string
      target: string
      sourceHandle: string | null
      targetHandle: string | null
      animated: boolean
      data: Record<string, unknown>
    }>
  } = {},
): Promise<string> {
  const projectId = randomUUID()

  await pool.query(
    `
      INSERT INTO projects (id, userid, name, description, scenes, active_scene_id, createdat, updatedat)
      VALUES ($1, $2, $3, '', $4::jsonb, $5, NOW(), NOW())
    `,
    [projectId, userId, `Project ${projectId}`, JSON.stringify(scenes), activeSceneId],
  )

  for (const node of legacyNodes) {
    await pool.query(
      `
        INSERT INTO canvas_nodes (projectId, nodeId, type, position_x, position_y, data)
        VALUES ($1::text, $2, $3, $4, $5, $6::jsonb)
      `,
      [projectId, node.id, node.type, node.positionX, node.positionY, JSON.stringify(node.data)],
    )
  }

  for (const edge of legacyEdges) {
    await pool.query(
      `
        INSERT INTO canvas_edges (
          projectId,
          edgeId,
          source,
          target,
          sourceHandle,
          targetHandle,
          animated,
          data
        )
        VALUES ($1::text, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        projectId,
        edge.id,
        edge.source,
        edge.target,
        edge.sourceHandle,
        edge.targetHandle,
        edge.animated,
        JSON.stringify(edge.data),
      ],
    )
  }

  return projectId
}
