import { getDb } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/main-session'
import { unauthorizedResponse } from '@/lib/project-ownership'
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

interface ProjectsRouteDependencies {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
  createProjectId?: () => string
}

// `origin` distinguishes how a project is meant to be worked in: 'canvas' (the
// node graph, the default) vs 'flow' (the simple, linear prompt→result
// generation thread — the Flow mode, usable on phone and desktop). The
// dashboard groups them separately and opens Flow projects in the thread UI
// instead of the canvas. Anything that isn't 'canvas' is treated as Flow, so
// legacy 'mobile' rows keep working. Cached so the idempotent ALTER runs once
// per serverless instance, not per request.
let projectsOriginReady = false
async function ensureProjectsOrigin(sql: ReturnType<typeof getDb>) {
  if (projectsOriginReady) return
  await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'canvas'`
  projectsOriginReady = true
}

export function createProjectsRouteHandlers(dependencies: ProjectsRouteDependencies = {}) {
  const getSql = dependencies.getDb ?? getDb
  const resolveUser = dependencies.getAuthenticatedUser ?? getAuthenticatedUser
  const createProjectId = dependencies.createProjectId ?? uuidv4

  return {
    async POST(request: NextRequest) {
      try {
        const user = await resolveUser(request)
        if (!user) {
          return unauthorizedResponse()
        }

        const sql = getSql()
        await ensureProjectsOrigin(sql)
        const { name, description, origin } = await request.json()
        const projectId = createProjectId()
        const safeOrigin = origin === 'flow' || origin === 'mobile' ? 'flow' : 'canvas'

        const result = await sql`
          INSERT INTO projects (id, userid, name, description, origin, createdat, updatedat)
          VALUES (${projectId}, ${user.id}, ${name || 'Untitled Project'}, ${description || ''}, ${safeOrigin}, NOW(), NOW())
          RETURNING id, name, description, thumbnail, origin, createdat, updatedat
        `

        return NextResponse.json(result[0])
      } catch (error) {
        console.error('[projects] Error creating project:', error)
        return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
      }
    },

    async GET(request: NextRequest) {
      try {
        const user = await resolveUser(request)
        if (!user) {
          return unauthorizedResponse()
        }

        const sql = getSql()
        await ensureProjectsOrigin(sql)
        const projects = await sql`
          SELECT
            p.id,
            p.name,
            p.description,
            COALESCE(shot1.thumb, p.thumbnail) AS thumbnail,
            COALESCE(p.origin, 'canvas') AS origin,
            p.createdat,
            p.updatedat
          FROM projects p
          LEFT JOIN LATERAL (
            SELECT COALESCE(
              data->>'videoThumbnail',
              data->>'outputUrl',
              data->>'thumbnail',
              data->>'assetUrl'
            ) AS thumb
            FROM canvas_nodes
            WHERE projectId = p.id::text
              AND (data->>'shotId' = 'shot-1' OR data->>'selectedShotId' = 'shot-1')
              AND COALESCE(
                data->>'videoThumbnail',
                data->>'outputUrl',
                data->>'thumbnail',
                data->>'assetUrl'
              ) IS NOT NULL
            LIMIT 1
          ) shot1 ON true
          WHERE p.userid = ${user.id}
          ORDER BY p.updatedat DESC
        `

        return NextResponse.json(projects)
      } catch (error) {
        console.error('[projects] Error fetching projects:', error)
        return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
      }
    },
  }
}

const handlers = createProjectsRouteHandlers()

export const POST = handlers.POST
export const GET = handlers.GET
