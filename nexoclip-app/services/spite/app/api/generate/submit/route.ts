import { NextRequest, NextResponse } from 'next/server'
import { buildModelInput, getModelById } from '@/lib/fal-models'
import { generateImage, submitVideo } from '@/lib/providers'
import { attachGeneratedMediaToNode, recordAsset, rehostToR2, toFalFetchableUrl } from '@/lib/r2-upload'
import { getDb } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  projectNotFoundResponse,
  unauthorizedResponse,
  userOwnsProject,
} from '@/lib/project-ownership'

interface GenerateSubmitDeps {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
  getModelById?: typeof getModelById
  buildModelInput?: typeof buildModelInput
  generateImage?: typeof generateImage
  submitVideo?: typeof submitVideo
  toFalFetchableUrl?: typeof toFalFetchableUrl
  rehostToR2?: typeof rehostToR2
  recordAsset?: typeof recordAsset
  attachGeneratedMediaToNode?: typeof attachGeneratedMediaToNode
}

export function createGenerateSubmitHandler(deps: GenerateSubmitDeps = {}) {
  const db = deps.getDb ?? getDb
  const resolveUser = deps.getAuthenticatedUser ?? getAuthenticatedUser
  const resolveModel = deps.getModelById ?? getModelById
  const buildInput = deps.buildModelInput ?? buildModelInput
  const generateImageWith = deps.generateImage ?? generateImage
  const submitVideoWith = deps.submitVideo ?? submitVideo
  const toFetchableUrl = deps.toFalFetchableUrl ?? toFalFetchableUrl
  const rehost = deps.rehostToR2 ?? rehostToR2
  const record = deps.recordAsset ?? recordAsset
  const attach = deps.attachGeneratedMediaToNode ?? attachGeneratedMediaToNode

  return async function POST(request: Request) {
    if (process.env.GENERATION_DISABLED === '1') {
      return NextResponse.json({ error: 'Generation is currently disabled by admin.' }, { status: 503 })
    }

    try {
      const body = await request.json()
      const projectId = typeof body.projectId === 'string' ? body.projectId : undefined
      let authenticatedUserId: string | null = null
      if (projectId) {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()
        authenticatedUserId = user.id
        const sql = db()
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }
      }

      const model = resolveModel(body.modelId)
      if (!model) return NextResponse.json({ error: `Unknown model: ${body.modelId}` }, { status: 400 })
      if (!body.prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })

      const incoming = [
        body.referenceImageUrl,
        ...(Array.isArray(body.referenceImageUrls) ? body.referenceImageUrls : []),
        ...(Array.isArray(body.referenceGroups) ? body.referenceGroups.flatMap((group: { urls?: string[] }) => group.urls || []) : []),
      ].filter(Boolean)
      const [referenceImages, endImageUrl] = await Promise.all([
        Promise.all(incoming.map(toFetchableUrl)).then((urls) => urls.filter(Boolean) as string[]),
        toFetchableUrl(body.endImageUrl),
      ])
      const input = buildInput(model, body.prompt, {
        ...body.settings,
        imageUrl: referenceImages[0],
        referenceImageUrls: referenceImages.slice(1),
        endImageUrl,
      })

      if (model.category === 'video') {
        const job = await submitVideoWith(model, input)
        return NextResponse.json({
          request_id: job.requestId,
          provider: job.provider,
          model: job.model,
          modelId: model.id,
          category: model.category,
        })
      }

      const output = await generateImageWith(model, input)
      const nodeId = typeof body.nodeId === 'string' ? body.nodeId : undefined
      const stored: string[] = []
      for (const source of output.images || []) {
        const url = await rehost(source)
        stored.push(url)
        if (projectId) await record('image', model.providerModel, body.prompt, url, projectId)
      }
      if (stored[0] && authenticatedUserId) {
        await attach({
          userId: authenticatedUserId,
          projectId,
          nodeId,
          url: stored[0],
        })
      }
      return NextResponse.json({
        request_id: crypto.randomUUID(),
        provider: model.provider,
        model: model.providerModel,
        modelId: model.id,
        category: model.category,
        status: 'COMPLETED',
        output: { images: stored, url: stored[0] },
      })
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'Generation failed' }, { status: Number(error?.status) || 500 })
    }
  }
}

const POST_HANDLER = createGenerateSubmitHandler()

export async function POST(request: NextRequest) {
  return POST_HANDLER(request)
}
