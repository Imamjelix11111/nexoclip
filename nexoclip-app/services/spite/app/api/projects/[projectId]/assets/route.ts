import { getDb } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  projectNotFoundResponse,
  unauthorizedResponse,
  userOwnsProject,
} from '@/lib/project-ownership'
import { NextRequest, NextResponse } from 'next/server'

interface ProjectAssetsRouteDependencies {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
}

export function createProjectAssetsRouteHandlers(dependencies: ProjectAssetsRouteDependencies = {}) {
  const getSql = dependencies.getDb ?? getDb
  const resolveUser = dependencies.getAuthenticatedUser ?? getAuthenticatedUser

  return {
    async GET(
      request: NextRequest,
      { params }: { params: Promise<{ projectId: string }> },
    ) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        const { projectId } = await params
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const assets = await sql`
          SELECT * FROM assets WHERE projectid = ${projectId} ORDER BY createdat DESC
        `

        return NextResponse.json(assets)
      } catch (error) {
        console.error('Asset list error:', error)
        return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 })
      }
    },

    async POST(
      request: NextRequest,
      { params }: { params: Promise<{ projectId: string }> },
    ) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        const { projectId } = await params
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const { assetId, tags } = await request.json()

        const result = await sql`
          UPDATE assets
          SET tags = ${tags}, updatedat = NOW()
          WHERE id = ${assetId}::uuid AND projectid = ${projectId}
          RETURNING id, name, tags, category, url
        `

        if (result.length === 0) {
          return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
        }

        return NextResponse.json(result[0])
      } catch (error) {
        console.error('Asset update error:', error)
        return NextResponse.json({ error: 'Update failed' }, { status: 500 })
      }
    },
  }
}

const handlers = createProjectAssetsRouteHandlers()

export const GET = handlers.GET
export const POST = handlers.POST
