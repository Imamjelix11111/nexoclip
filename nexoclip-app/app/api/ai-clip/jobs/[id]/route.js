import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../../src/services/tenantContext.js';

export async function GET(request, { params }) {
  if (!process.env.AI_CLIP_RUNTIME_URL || !process.env.AI_CLIP_RUNTIME_TOKEN) {
    return NextResponse.json({ error: 'AI Clip runtime is unavailable' }, { status: 503 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'job id is required' }, { status: 400 });

  try {
    const workspaceId = request.headers.get('x-workspace-id');
    if (!workspaceId) return NextResponse.json({ error: 'x-workspace-id is required' }, { status: 400 });
    await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Authentication required' ? 401 : 403 });
  }

  let response;
  try {
    response = await fetch(`${process.env.AI_CLIP_RUNTIME_URL.replace(/\/$/, '')}/internal/v1/clip-jobs/${encodeURIComponent(id)}`, {
      headers: { 'X-NexoClip-Runtime-Token': process.env.AI_CLIP_RUNTIME_TOKEN },
    });
  } catch {
    return NextResponse.json({ error: 'Unable to poll clip job' }, { status: 502 });
  }
  if (!response.ok) return NextResponse.json({ error: 'Unable to poll clip job' }, { status: 502 });
  return NextResponse.json(await response.json());
}
