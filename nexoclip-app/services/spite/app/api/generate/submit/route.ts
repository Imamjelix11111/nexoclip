import { NextRequest, NextResponse } from 'next/server'
import { buildModelInput, getModelById } from '@/lib/fal-models'
import { generateImage, submitVideo } from '@/lib/providers'
import { attachGeneratedMediaToNode, recordAsset, rehostToR2, toFalFetchableUrl } from '@/lib/r2-upload'

export async function POST(request: NextRequest) {
  if (process.env.GENERATION_DISABLED === '1') {
    return NextResponse.json({ error: 'Generation is currently disabled by admin.' }, { status: 503 })
  }

  try {
    const body = await request.json()
    const model = getModelById(body.modelId)
    if (!model) return NextResponse.json({ error: `Unknown model: ${body.modelId}` }, { status: 400 })
    if (!body.prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 })

    const incoming = [
      body.referenceImageUrl,
      ...(Array.isArray(body.referenceImageUrls) ? body.referenceImageUrls : []),
      ...(Array.isArray(body.referenceGroups) ? body.referenceGroups.flatMap((group: { urls?: string[] }) => group.urls || []) : []),
    ].filter(Boolean)
    const [referenceImages, endImageUrl] = await Promise.all([
      Promise.all(incoming.map(toFalFetchableUrl)).then((urls) => urls.filter(Boolean) as string[]),
      toFalFetchableUrl(body.endImageUrl),
    ])
    const input = buildModelInput(model, body.prompt, {
      ...body.settings,
      imageUrl: referenceImages[0],
      referenceImageUrls: referenceImages.slice(1),
      endImageUrl,
    })

    if (model.category === 'video') {
      const job = await submitVideo(model, input)
      return NextResponse.json({
        request_id: job.requestId,
        provider: job.provider,
        model: job.model,
        modelId: model.id,
        category: model.category,
      })
    }

    const output = await generateImage(model, input)
    const projectId = typeof body.projectId === 'string' ? body.projectId : undefined
    const nodeId = typeof body.nodeId === 'string' ? body.nodeId : undefined
    const stored: string[] = []
    for (const source of output.images || []) {
      const url = await rehostToR2(source)
      stored.push(url)
      if (projectId) await recordAsset('image', model.providerModel, body.prompt, url, projectId)
    }
    if (stored[0]) await attachGeneratedMediaToNode(projectId, nodeId, stored[0])
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
