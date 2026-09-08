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

interface GenerateSubmitRouteDependencies {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
  getModelById?: typeof getModelById
  buildModelInput?: typeof buildModelInput
  generateImage?: typeof generateImage
  submitVideo?: typeof submitVideo
  recordAsset?: typeof recordAsset
  attachGeneratedMediaToNode?: typeof attachGeneratedMediaToNode
  rehostToR2?: typeof rehostToR2
  toFalFetchableUrl?: typeof toFalFetchableUrl
}

export function createGenerateSubmitHandler(dependencies: GenerateSubmitRouteDependencies = {}) {
  const getSql = dependencies.getDb ?? getDb
  const resolveUser = dependencies.getAuthenticatedUser ?? getAuthenticatedUser
  const resolveModel = dependencies.getModelById ?? getModelById
  const buildInput = dependencies.buildModelInput ?? buildModelInput
  const generateImageFn = dependencies.generateImage ?? generateImage
  const submitVideoFn = dependencies.submitVideo ?? submitVideo
  const recordAssetFn = dependencies.recordAsset ?? recordAsset
  const attachGeneratedMediaToNodeFn = dependencies.attachGeneratedMediaToNode ?? attachGeneratedMediaToNode
  const rehostToR2Fn = dependencies.rehostToR2 ?? rehostToR2
  const toFalFetchableUrlFn = dependencies.toFalFetchableUrl ?? toFalFetchableUrl

  return async function POST(request: NextRequest) {
    if (process.env.GENERATION_DISABLED === '1') {
      return NextResponse.json({ error: 'Generation is currently disabled by admin.' }, { status: 503 })
    }

    try {
      const user = await resolveUser(request)
      if (!user) return unauthorizedResponse()

      const body = await request.json()
      const projectId = typeof body.projectId === 'string' ? body.projectId : undefined
      if (projectId) {
        const sql = getSql()
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
        Promise.all(incoming.map(toFalFetchableUrlFn)).then((urls) => urls.filter(Boolean) as string[]),
        toFalFetchableUrlFn(body.endImageUrl),
      ])
      const input = buildInput(model, body.prompt, {
        ...body.settings,
        imageUrl: referenceImages[0],
        referenceImageUrls: referenceImages.slice(1),
        endImageUrl,
      })

      if (model.category === 'video') {
        const job = await submitVideoFn(model, input)
        return NextResponse.json({
          request_id: job.requestId,
          provider: job.provider,
          model: job.model,
          modelId: model.id,
          category: model.category,
        })
      }

      const output = await generateImageFn(model, input)
      const nodeId = typeof body.nodeId === 'string' ? body.nodeId : undefined
      const stored: string[] = []
      for (const source of output.images || []) {
        const url = await rehostToR2Fn(source)
        stored.push(url)
        if (projectId) await recordAssetFn('image', model.providerModel, body.prompt, url, projectId)
      }
      if (stored[0]) await attachGeneratedMediaToNodeFn(projectId, nodeId, stored[0])
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

export const POST = createGenerateSubmitHandler()
