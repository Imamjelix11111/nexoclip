import * as Y from 'yjs'

import {
  CURRENT_SCHEMA_VERSION,
  createCanvasDocument,
  importLegacyCanvas,
  migrateCanvasDocument,
} from '../lib/realtime/document'
import {
  createDatabaseAdapter,
  DEFAULT_REALTIME_ADVISORY_LOCK_NAMESPACE,
  type DatabaseAdapter,
  type QueryResult,
  type Queryable,
} from './db'

type LoadRow = {
  snapshot: Uint8Array | null
  snapshot_seq: number | string
  durable_seq: number | string
  projected_seq: number | string
  schema_version: number | string
}

type UpdateRow = {
  seq: number | string
  update_data: Uint8Array
}

type ProjectMetaRow = {
  name: string | null
  scenes: Array<{ id: string; name: string }> | null
  active_scene_id: string | null
}

type LegacyNodeRow = {
  id: string
  type: string | null
  position_x: number | null
  position_y: number | null
  data: Record<string, unknown> | null
}

type LegacyEdgeRow = {
  id: string
  source: string
  target: string
  sourcehandle: string | null
  targethandle: string | null
  animated: boolean | null
  data: Record<string, unknown> | null
}

export type ProjectSequence = {
  projectId: string
  durableSeq: number
  projectedSeq: number
  lag: number
}

export type LoadedProjectDocument = {
  doc: Y.Doc
  snapshotSeq: number
  durableSeq: number
  projectedSeq: number
}

export type { DatabaseAdapter, QueryResult } from './db'

export class YjsRepository {
  readonly advisoryLockNamespace: number
  private readonly database: DatabaseAdapter

  constructor({
    database = createDatabaseAdapter(),
    advisoryLockNamespace = DEFAULT_REALTIME_ADVISORY_LOCK_NAMESPACE,
  }: {
    database?: DatabaseAdapter
    advisoryLockNamespace?: number
  } = {}) {
    this.database = database
    this.advisoryLockNamespace = advisoryLockNamespace
  }

  async ownsProject(projectId: string, userId: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM projects WHERE id = $1 AND userid = $2 LIMIT 1`,
      [projectId, userId],
    )

    return result.rows.length > 0
  }

  async loadOrImport(projectId: string): Promise<LoadedProjectDocument> {
    return this.database.transaction(async (tx) => {
      await this.acquireProjectLock(tx, projectId)

      const documentResult = await tx.query<LoadRow>(
        `
          SELECT snapshot, snapshot_seq, durable_seq, projected_seq, schema_version
          FROM canvas_yjs_documents
          WHERE project_id = $1
          FOR UPDATE
        `,
        [projectId],
      )

      const row = documentResult.rows[0]
      if (!row) {
        return this.importLegacyDocument(tx, projectId)
      }

      return this.hydrateDocument(tx, projectId, row)
    })
  }

  async appendUpdate(projectId: string, update: Uint8Array): Promise<number> {
    return this.database.transaction(async (tx) => {
      await this.acquireProjectLock(tx, projectId)

      const documentResult = await tx.query<{ durable_seq: number | string }>(
        `SELECT durable_seq FROM canvas_yjs_documents WHERE project_id = $1 FOR UPDATE`,
        [projectId],
      )
      const row = documentResult.rows[0]
      if (!row) {
        throw new Error(`Missing durable Yjs document for project ${projectId}`)
      }

      const nextSequence = asNumber(row.durable_seq) + 1

      await tx.query(
        `INSERT INTO canvas_yjs_updates (project_id, seq, update_data) VALUES ($1, $2, $3)`,
        [projectId, nextSequence, update],
      )
      await tx.query(
        `UPDATE canvas_yjs_documents SET durable_seq = $2, updated_at = NOW() WHERE project_id = $1`,
        [projectId, nextSequence],
      )

      return nextSequence
    })
  }

  async compact(
    projectId: string,
    snapshot: Uint8Array,
    includedSeq: number,
    schemaVersion: number,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      await this.acquireProjectLock(tx, projectId)

      const documentResult = await tx.query<{ durable_seq: number | string }>(
        `SELECT durable_seq FROM canvas_yjs_documents WHERE project_id = $1 FOR UPDATE`,
        [projectId],
      )
      const row = documentResult.rows[0]
      if (!row) {
        throw new Error(`Missing durable Yjs document for project ${projectId}`)
      }

      const durableSeq = asNumber(row.durable_seq)
      if (includedSeq > durableSeq) {
        throw new Error(
          `Cannot compact project ${projectId} beyond durable sequence ${durableSeq}`,
        )
      }

      await tx.query(
        `
          UPDATE canvas_yjs_documents
          SET snapshot = $2,
              snapshot_seq = $3,
              schema_version = $4,
              updated_at = NOW()
          WHERE project_id = $1
        `,
        [projectId, snapshot, includedSeq, schemaVersion],
      )
      await tx.query(
        `DELETE FROM canvas_yjs_updates WHERE project_id = $1 AND seq <= $2`,
        [projectId, includedSeq],
      )
    })
  }

  async loadProjectionLag(): Promise<ProjectSequence[]> {
    const result = await this.database.query<{
      project_id: string
      durable_seq: number | string
      projected_seq: number | string
      lag: number | string
    }>(
      `
        SELECT
          project_id,
          durable_seq,
          projected_seq,
          durable_seq - projected_seq AS lag
        FROM canvas_yjs_documents
        WHERE projected_seq < durable_seq
        ORDER BY lag DESC, project_id ASC
      `,
    )

    return result.rows.map((row) => ({
      projectId: row.project_id,
      durableSeq: asNumber(row.durable_seq),
      projectedSeq: asNumber(row.projected_seq),
      lag: asNumber(row.lag),
    }))
  }

  async close(): Promise<void> {
    await this.database.close()
  }

  private async acquireProjectLock(tx: Queryable, projectId: string): Promise<void> {
    await tx.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [
      this.advisoryLockNamespace,
      projectId,
    ])
  }

  private async hydrateDocument(
    tx: Queryable,
    projectId: string,
    row: LoadRow,
  ): Promise<LoadedProjectDocument> {
    const snapshotSeq = asNumber(row.snapshot_seq)
    const durableSeq = asNumber(row.durable_seq)
    const projectedSeq = asNumber(row.projected_seq)
    const schemaVersion = asNumber(row.schema_version)

    const doc = row.snapshot ? new Y.Doc() : createCanvasDocument()
    if (row.snapshot) {
      Y.applyUpdate(doc, row.snapshot)
    }

    const updatesResult = await tx.query<UpdateRow>(
      `
        SELECT seq, update_data
        FROM canvas_yjs_updates
        WHERE project_id = $1
          AND seq > $2
        ORDER BY seq ASC
      `,
      [projectId, snapshotSeq],
    )

    for (const update of updatesResult.rows) {
      Y.applyUpdate(doc, update.update_data)
    }

    if (migrateCanvasDocument(doc, schemaVersion)) {
      const migratedSnapshot = Y.encodeStateAsUpdate(doc)
      await tx.query(
        `
          UPDATE canvas_yjs_documents
          SET snapshot = $2,
              snapshot_seq = $3,
              schema_version = $4,
              updated_at = NOW()
          WHERE project_id = $1
        `,
        [projectId, migratedSnapshot, durableSeq, CURRENT_SCHEMA_VERSION],
      )
      await tx.query(
        `DELETE FROM canvas_yjs_updates WHERE project_id = $1 AND seq <= $2`,
        [projectId, durableSeq],
      )

      return {
        doc,
        snapshotSeq: durableSeq,
        durableSeq,
        projectedSeq,
      }
    }

    return {
      doc,
      snapshotSeq,
      durableSeq,
      projectedSeq,
    }
  }

  private async importLegacyDocument(
    tx: Queryable,
    projectId: string,
  ): Promise<LoadedProjectDocument> {
    const projectResult = await tx.query<ProjectMetaRow>(
      `SELECT name, scenes, active_scene_id FROM projects WHERE id = $1`,
      [projectId],
    )
    const nodeResult = await tx.query<LegacyNodeRow>(
      `
        SELECT nodeId AS id, type, position_x, position_y, data
        FROM canvas_nodes
        WHERE projectId = $1::text
        ORDER BY createdAt ASC, nodeId ASC
      `,
      [projectId],
    )
    const edgeResult = await tx.query<LegacyEdgeRow>(
      `
        SELECT edgeid AS id, source, target, sourcehandle, targethandle, animated, data
        FROM canvas_edges
        WHERE projectId = $1::text
        ORDER BY createdAt ASC, edgeid ASC
      `,
      [projectId],
    )

    const doc = createCanvasDocument()
    const meta = projectResult.rows[0]

    importLegacyCanvas(doc, {
      nodes: nodeResult.rows.map((row) => ({
        id: row.id,
        type: row.type ?? undefined,
        position: {
          x: Number(row.position_x ?? 0),
          y: Number(row.position_y ?? 0),
        },
        data: row.data ?? {},
      })),
      edges: edgeResult.rows.map((row) => ({
        id: row.id,
        source: row.source,
        target: row.target,
        sourceHandle: row.sourcehandle,
        targetHandle: row.targethandle,
        animated: row.animated ?? undefined,
        data: row.data ?? {},
      })),
      projectName: meta?.name ?? undefined,
      scenes: meta?.scenes ?? undefined,
      activeSceneId: meta?.active_scene_id ?? undefined,
    })

    const snapshot = Y.encodeStateAsUpdate(doc)
    await tx.query(
      `
        INSERT INTO canvas_yjs_documents (
          project_id,
          snapshot,
          snapshot_seq,
          durable_seq,
          projected_seq,
          schema_version
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [projectId, snapshot, 0, 0, 0, CURRENT_SCHEMA_VERSION],
    )

    return {
      doc,
      snapshotSeq: 0,
      durableSeq: 0,
      projectedSeq: 0,
    }
  }
}

function asNumber(value: number | string | null | undefined): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}
