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

interface GenerateStatusRouteDependencies {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
  pollVideo?: typeof pollVideo
  recordAsset?: typeof recordAsset
  attachGeneratedMediaToNode?: typeof attachGeneratedMediaToNode
  rehostToR2?: typeof rehostToR2
}

export function createGenerateStatusHandler(dependencies: GenerateStatusRouteDependencies = {}) {
  const getSql = dependencies.getDb ?? getDb
  const resolveUser = dependencies.getAuthenticatedUser ?? getAuthenticatedUser
  const pollVideoFn = dependencies.pollVideo ?? pollVideo
  const recordAssetFn = dependencies.recordAsset ?? recordAsset
  const attachGeneratedMediaToNodeFn = dependencies.attachGeneratedMediaToNode ?? attachGeneratedMediaToNode
  const rehostToR2Fn = dependencies.rehostToR2 ?? rehostToR2

  return async function GET(request: NextRequest) {
    const user = await resolveUser(request)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(request.url)
    const requestId = searchParams.get('request_id')
    const provider = searchParams.get('provider') || 'byteplus'
    if (!requestId) return NextResponse.json({ error: 'request_id is required' }, { status: 400 })
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(requestId)) return NextResponse.json({ error: 'Invalid request_id' }, { status: 400 })

    const projectId = searchParams.get('projectId') || undefined
    const scopedProjectId = projectId && projectId !== 'undefined' && projectId !== 'null' ? projectId : undefined
    if (scopedProjectId) {
      const sql = getSql()
      if (!(await userOwnsProject(sql, user.id, scopedProjectId))) {
        return projectNotFoundResponse()
      }
    }

    try {
      const result = await pollVideoFn(provider, requestId)
      if (result.status !== 'COMPLETED' || !result.output?.url) {
        return NextResponse.json({ ...result, requestId })
      }
      const stored = await rehostToR2Fn(result.output.url)
      const nodeId = searchParams.get('nodeId') || undefined
      if (scopedProjectId) {
        await recordAssetFn('video', searchParams.get('model') || 'byteplus', searchParams.get('prompt') || 'Generated asset', stored, scopedProjectId)
        await attachGeneratedMediaToNodeFn(scopedProjectId, nodeId, stored)
      }
      return NextResponse.json({ status: 'COMPLETED', output: { url: stored, videos: [stored] }, requestId })
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'Status check failed' }, { status: Number(error?.status) || 500 })
    }
  }
}

export const GET = createGenerateStatusHandler()
