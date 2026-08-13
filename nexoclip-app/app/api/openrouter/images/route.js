import { NextResponse } from 'next/server';
import { createOpenRouterImageAdapter } from '../../../../src/providers/openrouter/imageAdapter.js';

export async function POST(request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'OpenRouter is not configured' }, { status: 503 });
  }
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body?.model || !body?.prompt) {
    return NextResponse.json({ error: 'model and prompt are required' }, { status: 400 });
  }
  try {
    const adapter = createOpenRouterImageAdapter({ apiKey: process.env.OPENROUTER_API_KEY });
    const result = await adapter.generate({
      model: body.model,
      prompt: body.prompt,
      aspectRatio: body.aspect_ratio,
      resolution: body.resolution,
      quality: body.quality,
      seed: body.seed,
      referenceImages: (body.input_references || []).map((item) => item?.image_url?.url).filter(Boolean),
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return NextResponse.json({ error: error?.message || 'OpenRouter request failed', code: error?.code }, { status });
  }
}
