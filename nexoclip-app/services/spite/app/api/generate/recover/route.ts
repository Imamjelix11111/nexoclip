import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { isValidFalModel, isValidFalRequestId } from '@/lib/fal-validate'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  projectNotFoundResponse,
  unauthorizedResponse,
  userOwnsProject,
} from '@/lib/project-ownership'
import { recordAsset as persistAsset, rehostToR2 as rehostAssetToR2 } from '@/lib/r2-upload'

interface RecoveryItem {
  requestId: string
  modelEndpoint: string
  projectId: string
  hintedType?: 'image' | 'video'
  nodeId?: string
  prompt?: string
}

interface RecoveryResult {
  requestId: string
  projectId: string
  nodeId?: string
  status: 'recovered' | 'still_pending' | 'failed' | 'not_found' | 'error'
  assetUrl?: string
  message?: string
}

interface GenerateRecoverDeps {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
  falKey?: string
  fetchFalStatus?: (requestId: string, modelEndpoint: string, falKey: string) => Promise<Response>
  fetchFalResult?: (requestId: string, modelEndpoint: string, falKey: string) => Promise<Response>
  rehostToR2?: typeof rehostAssetToR2
  recordAsset?: typeof persistAsset
}

async function defaultFetchFalStatus(requestId: string, modelEndpoint: string, falKey: string) {
  return fetch(`https://queue.fal.run/${modelEndpoint}/requests/${requestId}/status`, {
    headers: { Authorization: `Key ${falKey}` },
  })
}

async function defaultFetchFalResult(requestId: string, modelEndpoint: string, falKey: string) {
  return fetch(`https://queue.fal.run/${modelEndpoint}/requests/${requestId}`, {
    headers: { Authorization: `Key ${falKey}` },
  })
}

function extractOutputUrl(result: any): { url: string | null; isVideo: boolean } {
  if (result?.video?.url) return { url: result.video.url, isVideo: true }
  if (result?.output?.url) {
    const url = result.output.url
    const isVideo = /\.(mp4|webm|mov|m4v)(?:\?|$)/i.test(url)
    return { url, isVideo }
  }
  if (result?.videos?.length) {
    const video = result.videos[0]
    const url = typeof video === 'string' ? video : video?.url
    if (url) return { url, isVideo: true }
  }
  if (result?.images?.length) {
    const image = result.images[0]
    const url = typeof image === 'string' ? image : image?.url
    if (url) return { url, isVideo: false }
  }
  if (result?.image?.url) return { url: result.image.url, isVideo: false }
  return { url: null, isVideo: false }
}

function createRecoverOne(deps: Required<Pick<GenerateRecoverDeps, 'fetchFalStatus' | 'fetchFalResult' | 'rehostToR2' | 'recordAsset'>>) {
  return async function recoverOne(item: RecoveryItem, falKey: string): Promise<RecoveryResult> {
    const responseBase = {
      requestId: item.requestId,
      projectId: item.projectId,
      nodeId: item.nodeId,
    }

    if (!isValidFalModel(item.modelEndpoint) || !isValidFalRequestId(item.requestId)) {
      return {
        ...responseBase,
        status: 'error',
        message: 'Invalid modelEndpoint or requestId — refusing to fetch.',
      }
    }

    const statusRes = await deps.fetchFalStatus(item.requestId, item.modelEndpoint, falKey)
    if (statusRes.status === 404) {
      return {
        ...responseBase,
        status: 'not_found',
        message: 'fal says this request does not exist (may have expired after 24h).',
      }
    }
    if (!statusRes.ok) {
      const text = await statusRes.text().catch(() => '')
      return {
        ...responseBase,
        status: 'error',
        message: `status check failed: ${statusRes.status} ${text.slice(0, 200)}`,
      }
    }

    const statusData = await statusRes.json()
    const falStatus = statusData.status as string | undefined
    if (falStatus === 'IN_QUEUE' || falStatus === 'IN_PROGRESS') {
      return {
        ...responseBase,
        status: 'still_pending',
        message: `fal says ${falStatus}.`,
      }
    }
    if (falStatus === 'FAILED') {
      return {
        ...responseBase,
        status: 'failed',
        message: 'fal reports the job failed.',
      }
    }
    if (falStatus !== 'COMPLETED') {
      return {
        ...responseBase,
        status: 'error',
        message: `unexpected fal status: ${falStatus}`,
      }
    }

    const resultRes = await deps.fetchFalResult(item.requestId, item.modelEndpoint, falKey)
    if (!resultRes.ok) {
      return {
        ...responseBase,
        status: 'error',
        message: `result fetch failed: ${resultRes.status}`,
      }
    }

    const result = await resultRes.json()
    const { url, isVideo: detectedVideo } = extractOutputUrl(result)
    if (!url) {
      return {
        ...responseBase,
        status: 'error',
        message: 'fal returned no usable output URL.',
      }
    }

    const isVideo = item.hintedType ? item.hintedType === 'video' : detectedVideo
    let storedUrl = url
    try {
      storedUrl = await deps.rehostToR2(url)
    } catch (err) {
      console.error('[recover] rehost failed, keeping fal URL:', err)
    }

    try {
      await deps.recordAsset(
        isVideo ? 'video' : 'image',
        item.modelEndpoint,
        item.prompt || 'Recovered generation',
        storedUrl,
        item.projectId,
        { recovered: true },
      )
    } catch (err) {
      console.error('[recover] recordAsset failed:', err)
      return {
        ...responseBase,
        status: 'error',
        message: 'Output retrieved but failed to record in assets library.',
        assetUrl: storedUrl,
      }
    }

    return {
      ...responseBase,
      status: 'recovered',
      assetUrl: storedUrl,
      message: `Saved as ${isVideo ? 'video' : 'image'} in your assets library.`,
    }
  }
}

export function createGenerateRecoverHandler(deps: GenerateRecoverDeps = {}) {
  const db = deps.getDb ?? getDb
  const resolveUser = deps.getAuthenticatedUser ?? getAuthenticatedUser
  const falKey = deps.falKey ?? process.env.FAL_KEY
  const recoverOne = createRecoverOne({
    fetchFalStatus: deps.fetchFalStatus ?? defaultFetchFalStatus,
    fetchFalResult: deps.fetchFalResult ?? defaultFetchFalResult,
    rehostToR2: deps.rehostToR2 ?? rehostAssetToR2,
    recordAsset: deps.recordAsset ?? persistAsset,
  })

  return async function POST(request: Request | NextRequest) {
    if (!falKey) {
      return NextResponse.json({ error: 'FAL_KEY not configured' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const user = await resolveUser(request)
    if (!user) return unauthorizedResponse()

    const sql = db()
    const projectFilter = body.projectId ? String(body.projectId) : null
    if (projectFilter && !(await userOwnsProject(sql, user.id, projectFilter))) {
      return projectNotFoundResponse()
    }

    if (body.mode === 'backfill-recent') {
      await sql`ALTER TABLE generation_history ADD COLUMN IF NOT EXISTS recovered boolean DEFAULT false`
      const hours = Math.max(0.25, Math.min(72, Number(body.withinHours) || 2))
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
      const updated = await sql`
        UPDATE generation_history
        SET recovered = true
        FROM projects p
        WHERE p.id = generation_history.project_id
          AND p.userid = ${user.id}
          AND created_at > ${cutoff.toISOString()}
          AND COALESCE(recovered, false) = false
          ${projectFilter ? sql`AND project_id = ${projectFilter}` : sql``}
          ${body.modelLike ? sql`AND model ILIKE ${String(body.modelLike)}` : sql``}
        RETURNING generation_history.id, generation_history.model, generation_history.prompt, generation_history.created_at
      `
      return NextResponse.json({
        mode: 'backfill-recent',
        hours,
        marked: updated.length,
        assets: updated,
      })
    }

    if (body.requestId && body.modelEndpoint) {
      if (!projectFilter) {
        return NextResponse.json(
          { error: 'projectId is required so we know where to file the recovered asset.' },
          { status: 400 },
        )
      }
      const requestIdRaw = String(body.requestId)
      const modelEndpointRaw = String(body.modelEndpoint)
      if (!isValidFalModel(modelEndpointRaw) || !isValidFalRequestId(requestIdRaw)) {
        return NextResponse.json({ error: 'Invalid modelEndpoint or requestId' }, { status: 400 })
      }
      const result = await recoverOne(
        {
          requestId: requestIdRaw,
          modelEndpoint: modelEndpointRaw,
          projectId: projectFilter,
          prompt: body.prompt ? String(body.prompt) : undefined,
          hintedType: body.type === 'video' || body.type === 'image' ? body.type : undefined,
        },
        falKey,
      )
      return NextResponse.json({ mode: 'manual', results: [result] })
    }

    const rows = await (projectFilter
      ? sql`
          SELECT projectId, nodeId, data, type
          FROM canvas_nodes
          WHERE projectId = ${projectFilter}::text
            AND data->>'pendingRequestId' IS NOT NULL
            AND data->>'pendingFalEndpoint' IS NOT NULL
        `
      : sql`
          SELECT c.projectId, c.nodeId, c.data, c.type
          FROM canvas_nodes c
          JOIN projects p ON p.id::text = c.projectId
          WHERE p.userid = ${user.id}
            AND c.data->>'pendingRequestId' IS NOT NULL
            AND c.data->>'pendingFalEndpoint' IS NOT NULL
        `)

    if (rows.length === 0) {
      return NextResponse.json({
        mode: 'bulk',
        scanned: 0,
        results: [],
        message: 'No nodes with pending fal requests were found.',
      })
    }

    const results: RecoveryResult[] = []
    for (const row of rows as any[]) {
      const data = (row.data || {}) as any
      const requestId = String(data.pendingRequestId)
      const modelEndpoint = String(data.pendingFalEndpoint)
      const projectId = String(row.projectid ?? row.projectId)
      const nodeId = String(row.nodeid ?? row.nodeId)
      const hintedType = row.type === 'videoGen' ? 'video' : row.type === 'imageGen' ? 'image' : undefined
      results.push(
        await recoverOne(
          {
            requestId,
            modelEndpoint,
            projectId,
            hintedType,
            nodeId,
            prompt: data.prompt ? String(data.prompt) : undefined,
          },
          falKey,
        ),
      )
    }

    const clearedByProject = new Map<string, string[]>()
    for (const result of results) {
      if (!result.nodeId || !['recovered', 'failed', 'not_found'].includes(result.status)) {
        continue
      }
      const projectId = result.projectId
      if (!projectId) continue
      if (!clearedByProject.has(projectId)) clearedByProject.set(projectId, [])
      clearedByProject.get(projectId)!.push(result.nodeId)
    }

    if (clearedByProject.size > 0) {
      try {
        for (const [authorizedProjectId, nodeIds] of clearedByProject) {
          await sql`
            UPDATE canvas_nodes
            SET data = data
              - 'pendingRequestId'
              - 'pendingFalEndpoint'
              - 'pendingStartedAt'
            WHERE projectId = ${authorizedProjectId}
              AND nodeId = ANY(${nodeIds}::text[])
          `
        }
      } catch (err) {
        console.error('[recover] failed to clear pending markers:', err)
      }
    }

    return NextResponse.json({
      mode: 'bulk',
      scanned: rows.length,
      recovered: results.filter((result) => result.status === 'recovered').length,
      stillPending: results.filter((result) => result.status === 'still_pending').length,
      failed: results.filter((result) => result.status === 'failed').length,
      notFound: results.filter((result) => result.status === 'not_found').length,
      errors: results.filter((result) => result.status === 'error').length,
      results,
    })
  }
}

const POST_HANDLER = createGenerateRecoverHandler()

export async function POST(request: NextRequest) {
  return POST_HANDLER(request)
}
