import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../src/services/tenantContext.js';

export async function POST(request) {
  if (!process.env.AI_CLIP_RUNTIME_URL || !process.env.AI_CLIP_RUNTIME_TOKEN) {
    return NextResponse.json({ error: 'AI Clip runtime is unavailable' }, { status: 503 });
  }
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body?.video_url) return NextResponse.json({ error: 'video_url is required' }, { status: 400 });

  let tenant;
  try {
    const workspaceId = request.headers.get('x-workspace-id');
    if (!workspaceId) return NextResponse.json({ error: 'x-workspace-id is required' }, { status: 400 });
    tenant = await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Authentication required' ? 401 : 403 });
  }

  let response;
  try {
    response = await fetch(`${process.env.AI_CLIP_RUNTIME_URL.replace(/\/$/, '')}/internal/v1/clip-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NexoClip-Runtime-Token': process.env.AI_CLIP_RUNTIME_TOKEN },
      body: JSON.stringify({
        video_url: body.video_url,
        num_clips: body.num_clips,
        aspect_ratio: body.aspect_ratio,
        topic_hint: typeof body.topic_hint === 'string' ? body.topic_hint.slice(0, 500) : '',
        workspace_id: tenant.workspace.id,
      }),
    });
  } catch {
    return NextResponse.json({ error: 'Unable to submit clip job' }, { status: 502 });
  }
  if (!response.ok) return NextResponse.json({ error: 'Unable to submit clip job' }, { status: 502 });
  return NextResponse.json(await response.json(), { status: 202 });
}
