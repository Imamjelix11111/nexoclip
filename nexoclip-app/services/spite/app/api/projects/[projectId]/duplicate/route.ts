import { getDb } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  projectNotFoundResponse,
  unauthorizedResponse,
  userOwnsProject,
} from '@/lib/project-ownership'
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

// Duplicate a project: copies the project row, all of its canvas_nodes, and
// all of its canvas_edges under a fresh project id. Asset/generation history
// is NOT cloned — the copy references the same assets as the original.
interface DuplicateProjectDeps {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
  createProjectId?: () => string
}

export function createDuplicateProjectHandler(deps: DuplicateProjectDeps = {}) {
  const db = deps.getDb ?? getDb
  const resolveUser = deps.getAuthenticatedUser ?? getAuthenticatedUser
  const createProjectId = deps.createProjectId ?? uuidv4

  return async function POST(
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

      const original = await sql`
        SELECT name, description, thumbnail, COALESCE(origin, 'canvas') AS origin
        FROM projects
        WHERE id = ${projectId}
      `
      if (original.length === 0) {
        return projectNotFoundResponse()
      }

      const newId = createProjectId()
      const newName = `${original[0].name} (Copy)`

      const inserted = await sql`
        INSERT INTO projects (id, userid, name, description, thumbnail, origin, createdat, updatedat)
        VALUES (
          ${newId},
          ${user.id},
          ${newName},
          ${original[0].description || ''},
          ${original[0].thumbnail || null},
          ${original[0].origin},
          NOW(),
          NOW()
        )
        RETURNING id, name, description, thumbnail, origin, createdat, updatedat
      `

      // Copy canvas in one shot per table — the (projectId, nodeId/edgeId)
      // composite PK already includes the new projectId, so collisions are
      // impossible and we keep the original node/edge ids for in-data references.
      await sql`
        INSERT INTO canvas_nodes (projectId, nodeId, type, position_x, position_y, data)
        SELECT ${newId}::text, nodeId, type, position_x, position_y, data
        FROM canvas_nodes
        WHERE projectId = ${projectId}::text
      `
      await sql`
        INSERT INTO canvas_edges (projectId, edgeId, source, target, sourceHandle, targetHandle, animated, data)
        SELECT ${newId}::text, edgeId, source, target, sourceHandle, targetHandle, animated, data
        FROM canvas_edges
        WHERE projectId = ${projectId}::text
      `

      return NextResponse.json(inserted[0])
    } catch (error) {
      console.error('[projects] Duplicate failed:', error)
      return NextResponse.json({ error: 'Failed to duplicate project' }, { status: 500 })
    }
  }
}

const POST_HANDLER = createDuplicateProjectHandler()

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  return POST_HANDLER(request, context)
}
