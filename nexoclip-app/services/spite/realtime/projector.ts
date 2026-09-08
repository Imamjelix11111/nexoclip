import * as Y from 'yjs'

import { readCanvasProjection } from '../lib/realtime/document'
import {
  createDatabaseAdapter,
  DEFAULT_REALTIME_ADVISORY_LOCK_NAMESPACE,
  type DatabaseAdapter,
} from './db'

type ProjectionRow = {
  durable_seq: number | string
  projected_seq: number | string
}

export type ProjectDocumentOptions = {
  database?: DatabaseAdapter
  advisoryLockNamespace?: number
}

/**
 * Caller contract: Task 6 serializes active Y.Doc mutations around this call.
 * This function validates the durable sequence boundary first, then snapshots an
 * immutable projection payload from the supplied doc before any compatibility writes.
 */
export async function projectDocument(
  projectId: string,
  doc: Y.Doc,
  targetSeq: number,
  {
    database = createDatabaseAdapter(),
    advisoryLockNamespace = DEFAULT_REALTIME_ADVISORY_LOCK_NAMESPACE,
  }: ProjectDocumentOptions = {},
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [
      advisoryLockNamespace,
      projectId,
    ])

    const documentResult = await tx.query<ProjectionRow>(
      `
        SELECT durable_seq, projected_seq
        FROM canvas_yjs_documents
        WHERE project_id = $1
        FOR UPDATE
      `,
      [projectId],
    )

    const row = documentResult.rows[0]
    if (!row) {
      throw new Error(`Missing durable Yjs document for project ${projectId}`)
    }

    const durableSeq = asNumber(row.durable_seq)
    const projectedSeq = asNumber(row.projected_seq)
    if (targetSeq <= projectedSeq) {
      return
    }

    if (targetSeq > durableSeq) {
      throw new Error(
        `Cannot project project ${projectId} beyond durable sequence ${durableSeq}`,
      )
    }

    if (targetSeq !== durableSeq) {
      throw new Error(
        `Projection target sequence ${targetSeq} must equal durable sequence ${durableSeq} for project ${projectId}`,
      )
    }

    const projection = captureProjectionPayload(doc)

    await tx.query(`DELETE FROM canvas_nodes WHERE projectId = $1::text`, [projectId])
    await tx.query(`DELETE FROM canvas_edges WHERE projectId = $1::text`, [projectId])

    for (const node of projection.nodes) {
      await tx.query(
        `
          INSERT INTO canvas_nodes (projectId, nodeId, type, position_x, position_y, data)
          VALUES ($1::text, $2, $3, $4, $5, $6::jsonb)
          ON CONFLICT (projectId, nodeId) DO UPDATE SET
            type = EXCLUDED.type,
            position_x = EXCLUDED.position_x,
            position_y = EXCLUDED.position_y,
            data = EXCLUDED.data
        `,
        [
          projectId,
          node.id,
          node.type ?? null,
          Number(node.position.x),
          Number(node.position.y),
          JSON.stringify(node.data ?? {}),
        ],
      )
    }

    for (const edge of projection.edges) {
      await tx.query(
        `
          INSERT INTO canvas_edges (projectId, edgeId, source, target, sourceHandle, targetHandle, animated, data)
          VALUES ($1::text, $2, $3, $4, $5, $6, $7, $8::jsonb)
          ON CONFLICT (projectId, edgeId) DO UPDATE SET
            source = EXCLUDED.source,
            target = EXCLUDED.target,
            sourceHandle = EXCLUDED.sourceHandle,
            targetHandle = EXCLUDED.targetHandle,
            animated = EXCLUDED.animated,
            data = EXCLUDED.data
        `,
        [
          projectId,
          edge.id,
          edge.source,
          edge.target,
          edge.sourceHandle ?? null,
          edge.targetHandle ?? null,
          edge.animated ?? null,
          JSON.stringify(edge.data ?? {}),
        ],
      )
    }

    await tx.query(
      `
        UPDATE projects
        SET updatedat = NOW(),
            scenes = $2::jsonb,
            active_scene_id = $3
        WHERE id = $1
      `,
      [projectId, JSON.stringify(projection.scenes), projection.activeSceneId],
    )

    await tx.query(
      `
        UPDATE canvas_yjs_documents
        SET projected_seq = $2,
            updated_at = NOW()
        WHERE project_id = $1
      `,
      [projectId, targetSeq],
    )
  })
}

function captureProjectionPayload(doc: Y.Doc) {
  return structuredClone(readCanvasProjection(doc))
}

function asNumber(value: number | string | null | undefined): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}
