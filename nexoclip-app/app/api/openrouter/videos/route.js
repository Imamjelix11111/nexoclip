import { NextResponse } from 'next/server';
import { createOpenRouterVideoAdapter } from '../../../../src/providers/openrouter/videoAdapter.js';
import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../src/services/tenantContext.js';

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
    const workspaceId = request.headers.get('x-workspace-id');
    if (!workspaceId) return NextResponse.json({ error: 'x-workspace-id is required' }, { status: 400 });
    await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Authentication required' ? 401 : 403 });
  }
  try {
    const adapter = createOpenRouterVideoAdapter({ apiKey: process.env.OPENROUTER_API_KEY });
    const result = await adapter.submit({
      model: body.model,
      prompt: body.prompt,
      duration: body.duration,
      resolution: body.resolution,
      aspectRatio: body.aspect_ratio,
      generateAudio: body.generate_audio,
      seed: body.seed,
      frameImages: body.frame_images,
      referenceImages: (body.input_references || []).map((item) => item?.image_url?.url).filter(Boolean),
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return NextResponse.json({ error: error?.message || 'OpenRouter request failed', code: error?.code }, { status });
  }
}
