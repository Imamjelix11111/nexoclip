import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { withBasePath } from '@/lib/base-path'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  projectNotFoundResponse,
  unauthorizedResponse,
  userOwnsProject,
} from '@/lib/project-ownership'

interface GenerateLatestRouteDependencies {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
}

export function createGenerateLatestHandler(dependencies: GenerateLatestRouteDependencies = {}) {
  const getSql = dependencies.getDb ?? getDb
  const resolveUser = dependencies.getAuthenticatedUser ?? getAuthenticatedUser

  return async function GET(request: NextRequest) {
    const user = await resolveUser(request)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const type = searchParams.get('type')
    const prompt = searchParams.get('prompt')
    const since = Number(searchParams.get('since'))

    if (!projectId || !prompt || !['image', 'video'].includes(type || '') || !Number.isFinite(since)) {
      return NextResponse.json({ error: 'Invalid recovery query' }, { status: 400 })
    }

    const sql = getSql()
    if (!(await userOwnsProject(sql, user.id, projectId))) {
      return projectNotFoundResponse()
    }

    const rows = await sql`
      SELECT r2_url
      FROM generation_history
      WHERE project_id = ${projectId}
        AND type = ${type}
        AND prompt = ${prompt}
        AND created_at >= ${new Date(since)}
      ORDER BY created_at DESC
      LIMIT 1
    `
    const url = (rows[0] as { r2_url?: string } | undefined)?.r2_url
    return NextResponse.json(url ? { status: 'COMPLETED', output: { url: withBasePath(url) } } : { status: 'NOT_FOUND' })
  }
}

export const GET = createGenerateLatestHandler()
