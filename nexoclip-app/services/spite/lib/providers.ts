import type { DirectProvider, ModelConfig } from './fal-models'

export interface ProviderJob {
  provider: DirectProvider
  requestId: string
  model: string
}
export interface ProviderOutput { images?: string[]; videos?: string[]; url?: string }
export interface ProviderStatus { status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'; output?: ProviderOutput; error?: string }

type GenerateInput = ReturnType<typeof import('./fal-models').buildModelInput>

const roots = () => ({
  google: (process.env.GOOGLE_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, ''),
  openai: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  byteplus: (process.env.BYTEPLUS_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, ''),
})

function key(provider: DirectProvider) {
  const value = provider === 'google'
    ? process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    : provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.BYTEPLUS_API_KEY
  if (!value) throw Object.assign(new Error(`${provider.toUpperCase()} API key not configured`), { status: 503 })
  return value
}

async function providerFetch(url: string, init: RequestInit, provider: DirectProvider) {
  const response = await fetch(url, init)
  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    let message = `${provider} request failed (${response.status})`
    try { message = JSON.parse(raw)?.error?.message || JSON.parse(raw)?.message || message } catch {}
    throw Object.assign(new Error(String(message).slice(0, 400)), { status: response.status })
  }
  return response
}

async function fetchDataUrl(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Reference fetch failed (${response.status})`)
  const type = response.headers.get('content-type') || 'image/png'
  return { inlineData: { mimeType: type, data: Buffer.from(await response.arrayBuffer()).toString('base64') } }
}

function normalizedImages(payload: any): string[] {
  return (payload?.data || payload?.predictions || (payload?.candidates || []).flatMap((c: any) => c?.content?.parts || []))
    .map((item: any) => item?.url || item?.image_url || (item?.b64_json || item?.inlineData?.data || item?.data
      ? `data:${item?.mime_type || item?.mimeType || item?.inlineData?.mimeType || 'image/png'};base64,${item?.b64_json || item?.inlineData?.data || item?.data}`
      : null))
    .filter(Boolean)
}

export async function generateImage(model: ModelConfig, input: GenerateInput): Promise<ProviderOutput> {
  let response: Response
  if (model.provider === 'google') {
    const parts = await Promise.all((input.referenceImages || []).map(fetchDataUrl))
    response = await providerFetch(
      `${roots().google}/models/${encodeURIComponent(model.providerModel)}:generateContent?key=${encodeURIComponent(key('google'))}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [...parts, { text: input.prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: input.aspectRatio, ...(input.resolution ? { imageSize: input.resolution } : {}) } } }) },
      'google',
    )
  } else if (model.provider === 'openai') {
    if (input.referenceImages?.length) {
      const form = new FormData()
      form.append('model', model.providerModel); form.append('prompt', input.prompt)
      if (input.resolution) form.append('quality', input.resolution.toLowerCase().includes('k') ? 'high' : input.resolution)
      for (const [i, url] of input.referenceImages.entries()) {
        const r = await fetch(url); form.append('image[]', await r.blob(), `reference-${i}.png`)
      }
      response = await providerFetch(`${roots().openai}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${key('openai')}` }, body: form }, 'openai')
    } else {
      response = await providerFetch(`${roots().openai}/images/generations`, { method: 'POST', headers: { Authorization: `Bearer ${key('openai')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.providerModel, prompt: input.prompt, quality: input.resolution?.toLowerCase().includes('k') ? 'high' : input.resolution }) }, 'openai')
    }
  } else {
    response = await providerFetch(`${roots().byteplus}/images/generations`, { method: 'POST', headers: { Authorization: `Bearer ${key('byteplus')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.providerModel, prompt: input.prompt, response_format: 'url', size: input.resolution, ...(input.referenceImages?.length ? { image: input.referenceImages } : {}) }) }, 'byteplus')
  }
  const images = normalizedImages(await response.json())
  if (!images.length) throw Object.assign(new Error(`${model.provider} returned no image`), { status: 502 })
  return { images, url: images[0] }
}

export async function submitVideo(model: ModelConfig, input: GenerateInput): Promise<ProviderJob> {
  const content: any[] = [{ type: 'text', text: input.prompt }]
  input.referenceImages?.forEach((url) => content.push({ type: 'image_url', role: 'reference_image', image_url: { url } }))
  if (input.endImageUrl) content.push({ type: 'image_url', role: 'last_frame', image_url: { url: input.endImageUrl } })
  const response = await providerFetch(`${roots().byteplus}/contents/generations/tasks`, { method: 'POST', headers: { Authorization: `Bearer ${key('byteplus')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.providerModel, content, duration: input.duration, resolution: input.resolution, aspect_ratio: input.aspectRatio, generate_audio: input.generateAudio }) }, 'byteplus')
  const payload = await response.json()
  const requestId = payload.id || payload.request_id
  if (!requestId) throw Object.assign(new Error('BytePlus returned no request id'), { status: 502 })
  return { provider: 'byteplus', requestId, model: model.providerModel }
}

export async function pollVideo(provider: string, requestId: string): Promise<ProviderStatus> {
  if (provider !== 'byteplus') return { status: 'FAILED', error: 'Unsupported generation provider' }
  const response = await providerFetch(`${roots().byteplus}/contents/generations/tasks/${encodeURIComponent(requestId)}`, { headers: { Authorization: `Bearer ${key('byteplus')}` } }, 'byteplus')
  const payload = await response.json()
  const state = String(payload.status || '').toLowerCase()
  if (['failed', 'cancelled', 'expired'].includes(state)) return { status: 'FAILED', error: payload.error?.message || payload.error || 'Generation failed' }
  if (['succeeded', 'completed', 'success'].includes(state)) {
    const url = payload.content?.video_url || payload.content?.url || payload.output?.[0]?.url
    return url ? { status: 'COMPLETED', output: { url, videos: [url] } } : { status: 'FAILED', error: 'BytePlus returned no video' }
  }
  return { status: state === 'queued' ? 'IN_QUEUE' : 'IN_PROGRESS' }
}
