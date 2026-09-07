import { NextRequest, NextResponse } from 'next/server'
import { pollVideo } from '@/lib/providers'
import { attachGeneratedMediaToNode, recordAsset, rehostToR2 } from '@/lib/r2-upload'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const requestId = searchParams.get('request_id')
  const provider = searchParams.get('provider') || 'byteplus'
  if (!requestId) return NextResponse.json({ error: 'request_id is required' }, { status: 400 })
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(requestId)) return NextResponse.json({ error: 'Invalid request_id' }, { status: 400 })

  try {
    const result = await pollVideo(provider, requestId)
    if (result.status !== 'COMPLETED' || !result.output?.url) {
      return NextResponse.json({ ...result, requestId })
    }
    const stored = await rehostToR2(result.output.url)
    const projectId = searchParams.get('projectId') || undefined
    const nodeId = searchParams.get('nodeId') || undefined
    if (projectId && projectId !== 'undefined' && projectId !== 'null') {
      await recordAsset('video', searchParams.get('model') || 'byteplus', searchParams.get('prompt') || 'Generated asset', stored, projectId)
      await attachGeneratedMediaToNode(projectId, nodeId, stored)
    }
    return NextResponse.json({ status: 'COMPLETED', output: { url: stored, videos: [stored] }, requestId })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Status check failed' }, { status: Number(error?.status) || 500 })
  }
}
