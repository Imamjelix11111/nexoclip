import { getDb } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  projectNotFoundResponse,
  unauthorizedResponse,
  userOwnsProject,
} from '@/lib/project-ownership'
import {
  createInternalRealtimeClient,
  type InternalRealtimeClient,
} from '@/lib/realtime/internal-client'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/projects/<id>/canvas/snapshots
// Returns the rolling list of compatibility snapshots for this project
// (newest first), each with a small summary so the user can pick one to
// restore after a bad sync or crash.
//
// To restore, POST to this same URL with `{ snapshotId: '<uuid>' }`. The
// route first snapshots the current projection for rollback, then restores
// the selected snapshot by replacing the authoritative realtime document via
// the trusted internal realtime API.
interface SnapshotRouteDeps {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
  createInternalRealtimeClient?: () => InternalRealtimeClient
}

export function createCanvasSnapshotRouteHandlers(deps: SnapshotRouteDeps = {}) {
  const db = deps.getDb ?? getDb
  const resolveUser = deps.getAuthenticatedUser ?? getAuthenticatedUser
  const internalRealtime = deps.createInternalRealtimeClient ?? createInternalRealtimeClient

  return {
    async GET(
      request: Request,
      { params }: { params: Promise<{ projectId: string }> },
    ) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = db()
        const { projectId } = await params
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const rows = await sql`
          SELECT id, saved_at,
                 jsonb_array_length(nodes_json) AS node_count,
                 jsonb_array_length(edges_json) AS edge_count
          FROM canvas_snapshots
          WHERE project_id = ${projectId}
          ORDER BY saved_at DESC
        `
        return NextResponse.json({
          snapshots: rows.map((r: any) => ({
            id: r.id,
            savedAt: r.saved_at,
            nodeCount: r.node_count,
            edgeCount: r.edge_count,
          })),
        })
      } catch (err: any) {
        console.error('[canvas/snapshots] GET error:', err)
        return NextResponse.json(
          { error: 'failed to list snapshots' },
          { status: 500 },
        )
      }
    },

    async POST(
      request: Request,
      { params }: { params: Promise<{ projectId: string }> },
    ) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = db()
        const { projectId } = await params
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const { snapshotId } = await request.json()
        if (!snapshotId) {
          return NextResponse.json(
            { error: 'snapshotId is required' },
            { status: 400 },
          )
        }

        const snap = await sql`
          SELECT id, nodes_json, edges_json
          FROM canvas_snapshots
          WHERE project_id = ${projectId} AND id = ${snapshotId}::uuid
          LIMIT 1
        `
        if (snap.length === 0) {
          return NextResponse.json(
            { error: 'snapshot not found' },
            { status: 404 },
          )
        }
        const nodes = (snap[0] as any).nodes_json as any[]
        const edges = (snap[0] as any).edges_json as any[]

        const realtime = internalRealtime()
        const currentDocument = await realtime.exportDocument({
          userId: user.id,
          projectId,
        })

        try {
          await sql`
            INSERT INTO canvas_snapshots (project_id, nodes_json, edges_json)
            VALUES (
              ${projectId},
              ${JSON.stringify(currentDocument.projection.nodes)}::jsonb,
              ${JSON.stringify(currentDocument.projection.edges)}::jsonb
            )
          `
          await sql`
            DELETE FROM canvas_snapshots
            WHERE project_id = ${projectId}
              AND id IN (
                SELECT id FROM canvas_snapshots
                WHERE project_id = ${projectId}
                ORDER BY saved_at DESC
                OFFSET 30
              )
          `
        } catch (preSnapErr) {
          console.error('[canvas/snapshots] pre-restore snapshot failed (non-fatal):', preSnapErr)
        }

        await realtime.replaceDocument({
          userId: user.id,
          projectId,
          projection: {
            nodes,
            edges,
            scenes: currentDocument.projection.scenes,
            activeSceneId: currentDocument.projection.activeSceneId,
          },
        })

        return NextResponse.json({
          success: true,
          restored: { nodeCount: nodes.length, edgeCount: edges.length },
        })
      } catch (err: any) {
        console.error('[canvas/snapshots] POST error:', err)
        return NextResponse.json(
          { error: 'restore failed' },
          { status: 500 },
        )
      }
    },
  }
}

const handlers = createCanvasSnapshotRouteHandlers()

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  return handlers.GET(request, context)
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  return handlers.POST(request, context)
}
