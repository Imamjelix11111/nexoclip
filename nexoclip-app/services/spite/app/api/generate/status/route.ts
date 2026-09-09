import { NextRequest, NextResponse } from 'next/server'
import { pollVideo } from '@/lib/providers'
import { attachGeneratedMediaToNode, recordAsset, rehostToR2 } from '@/lib/r2-upload'
import { getDb } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  projectNotFoundResponse,
  unauthorizedResponse,
  userOwnsProject,
} from '@/lib/project-ownership'

interface GenerateStatusDeps {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
  pollVideo?: typeof pollVideo
  rehostToR2?: typeof rehostToR2
  recordAsset?: typeof recordAsset
  attachGeneratedMediaToNode?: typeof attachGeneratedMediaToNode
}

export function createGenerateStatusHandler(deps: GenerateStatusDeps = {}) {
  const db = deps.getDb ?? getDb
  const resolveUser = deps.getAuthenticatedUser ?? getAuthenticatedUser
  const pollVideoWith = deps.pollVideo ?? pollVideo
  const rehost = deps.rehostToR2 ?? rehostToR2
  const record = deps.recordAsset ?? recordAsset
  const attach = deps.attachGeneratedMediaToNode ?? attachGeneratedMediaToNode

  return async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const requestId = searchParams.get('request_id')
    const provider = searchParams.get('provider') || 'byteplus'
    if (!requestId) return NextResponse.json({ error: 'request_id is required' }, { status: 400 })
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(requestId)) return NextResponse.json({ error: 'Invalid request_id' }, { status: 400 })

    const projectId = searchParams.get('projectId') || undefined
    let authenticatedUserId: string | null = null
    if (projectId && projectId !== 'undefined' && projectId !== 'null') {
      const user = await resolveUser(request)
      if (!user) return unauthorizedResponse()
      authenticatedUserId = user.id
      const sql = db()
      if (!(await userOwnsProject(sql, user.id, projectId))) {
        return projectNotFoundResponse()
      }
    }

    try {
      const result = await pollVideoWith(provider, requestId)
      if (result.status !== 'COMPLETED' || !result.output?.url) {
        return NextResponse.json({ ...result, requestId })
      }
      const stored = await rehost(result.output.url)
      const nodeId = searchParams.get('nodeId') || undefined
      if (projectId && projectId !== 'undefined' && projectId !== 'null') {
        await record('video', searchParams.get('model') || 'byteplus', searchParams.get('prompt') || 'Generated asset', stored, projectId)
        if (authenticatedUserId) {
          await attach({
            userId: authenticatedUserId,
            projectId,
            nodeId,
            url: stored,
          })
        }
      }
      return NextResponse.json({ status: 'COMPLETED', output: { url: stored, videos: [stored] }, requestId })
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'Status check failed' }, { status: Number(error?.status) || 500 })
    }
  }
}

const GET_HANDLER = createGenerateStatusHandler()

export async function GET(request: NextRequest) {
  return GET_HANDLER(request)
}
