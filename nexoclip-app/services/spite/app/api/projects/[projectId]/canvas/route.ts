import { getDb } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  projectNotFoundResponse,
  unauthorizedResponse,
  userOwnsProject,
} from '@/lib/project-ownership'
import { NextRequest, NextResponse } from 'next/server'

const PROJECTION_SOURCE = 'projection'

// Compatibility-only projection metadata: older installs can still lack the
// scenes / active_scene_id columns, so reads lazily add them before returning
// projection data. This route never restores authoritative canvas state.
async function ensureSceneColumns(sql: any) {
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS scenes jsonb`
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS active_scene_id text`
}

interface CanvasRouteDeps {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
}

export function createCanvasRouteHandlers(deps: CanvasRouteDeps = {}) {
  const db = deps.getDb ?? getDb
  const resolveUser = deps.getAuthenticatedUser ?? getAuthenticatedUser

  return {
    async POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = db()
        const { projectId } = await params
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        return NextResponse.json(
          { error: 'Canvas save endpoint is gone; use realtime sync' },
          { status: 410 },
        )
      } catch (error) {
        console.error('Error rejecting legacy canvas save:', error)
        return NextResponse.json({ error: 'Failed to reject legacy canvas save' }, { status: 500 })
      }
    },

    async GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = db()
        const { projectId } = await params
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        await ensureSceneColumns(sql)

        const nodesResult = await sql`
          SELECT nodeId as id, type, position_x, position_y, data
          FROM canvas_nodes
          WHERE projectId = ${projectId}::text
          ORDER BY createdAt
        `

        const edgesResult = await sql`
          SELECT edgeid as id, source, target, sourcehandle, targethandle, animated, data
          FROM canvas_edges
          WHERE projectId = ${projectId}::text
          ORDER BY createdAt
        `

        const projectMeta = await sql`
          SELECT scenes, active_scene_id FROM projects WHERE id = ${projectId}
        `
        const savedScenes = (projectMeta[0] as any)?.scenes as
          | { id: string; name: string }[]
          | null
          | undefined
        const scenes =
          Array.isArray(savedScenes) && savedScenes.length > 0
            ? savedScenes
            : [{ id: 'scene-1', name: 'Scene 1' }]
        const activeSceneId =
          ((projectMeta[0] as any)?.active_scene_id as string | null)
          || scenes[0]?.id
          || 'scene-1'

        const nodes = nodesResult.map((row: any) => ({
          id: row.id,
          type: row.type,
          position: { x: row.position_x, y: row.position_y },
          data: row.data || {},
        }))

        const edges = edgesResult.map((row: any) => ({
          id: row.id,
          source: row.source,
          target: row.target,
          sourceHandle: row.sourcehandle,
          targetHandle: row.targethandle,
          animated: row.animated,
          data: row.data || {},
        }))

        return NextResponse.json(
          { nodes, edges, scenes, activeSceneId, source: PROJECTION_SOURCE },
          { headers: { 'X-Canvas-Source': PROJECTION_SOURCE } },
        )
      } catch (error) {
        console.error('Error loading canvas:', error)
        return NextResponse.json({ error: 'Failed to load canvas' }, { status: 500 })
      }
    },
  }
}

const handlers = createCanvasRouteHandlers()

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  return handlers.POST(request, context)
}

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  return handlers.GET(request, context)
}
