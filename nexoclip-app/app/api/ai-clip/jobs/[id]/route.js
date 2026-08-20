import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../../src/services/tenantContext.js';
import { getPool } from '../../../../../src/db/pool.js';
import { updateJobStatus } from '../../../../../src/services/jobService.js';

async function markJobStatus({ workspaceId, jobId, status, result, error }) {
  if (!jobId) return;
  try {
    await updateJobStatus({ pool: getPool(), workspaceId, id: jobId, status, result, error });
  } catch {
    // A job-update failure must never break the poll response — best effort only.
  }
}

export async function GET(request, { params }) {
  if (!process.env.AI_CLIP_RUNTIME_URL || !process.env.AI_CLIP_RUNTIME_TOKEN) {
    return NextResponse.json({ error: 'AI Clip runtime is unavailable' }, { status: 503 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'job id is required' }, { status: 400 });

  const url = new URL(request.url);
  const jobId = url.searchParams.get('job_id');

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
    response = await fetch(`${process.env.AI_CLIP_RUNTIME_URL.replace(/\/$/, '')}/internal/v1/clip-jobs/${encodeURIComponent(id)}`, {
      headers: { 'X-NexoClip-Runtime-Token': process.env.AI_CLIP_RUNTIME_TOKEN },
    });
  } catch {
    return NextResponse.json({ error: 'Unable to poll clip job' }, { status: 502 });
  }
  if (!response.ok) return NextResponse.json({ error: 'Unable to poll clip job' }, { status: 502 });
  const data = await response.json();

  if (data.status === 'completed') {
    const shorts = data.shorts || [];
    await markJobStatus({
      workspaceId: tenant.workspace.id,
      jobId,
      status: 'succeeded',
      result: { kind: 'clipping', title: 'AI clipping', outputUrl: shorts.find((s) => s.url)?.url ?? null },
    });
  } else if (data.status === 'failed') {
    await markJobStatus({
      workspaceId: tenant.workspace.id,
      jobId,
      status: 'failed',
      error: { message: 'Clipping failed' },
    });
  }

  return NextResponse.json(data);
}
