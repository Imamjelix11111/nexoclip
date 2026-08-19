import { NextResponse } from 'next/server';
import { createOpenRouterVideoAdapter } from '../../../../../src/providers/openrouter/videoAdapter.js';
import { SESSION_COOKIE } from '../../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../../src/services/tenantContext.js';
import { persistUploadedAsset } from '../../../../../src/services/uploadedAssetService.js';
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
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'OpenRouter is not configured' }, { status: 503 });
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

  const adapter = createOpenRouterVideoAdapter({ apiKey: process.env.OPENROUTER_API_KEY });
  try {
    const status = await adapter.poll(id);
    if (status.status === 'failed' || status.status === 'cancelled' || status.status === 'expired') {
      await markJobStatus({
        workspaceId: tenant.workspace.id,
        jobId,
        status: 'failed',
        error: { message: status.error || status.status },
      });
      return NextResponse.json({ status: status.status, error: status.error || null });
    }
    if (status.status !== 'completed') {
      await markJobStatus({ workspaceId: tenant.workspace.id, jobId, status: 'running' });
      return NextResponse.json({ status: status.status });
    }
    const { buffer, contentType } = await adapter.downloadContent(id, 0);
    const asset = await persistUploadedAsset({
      workspaceId: tenant.workspace.id,
      buffer,
      contentType,
      filename: `${id}.mp4`,
    });
    await markJobStatus({
      workspaceId: tenant.workspace.id,
      jobId,
      status: 'succeeded',
      result: { kind: 'video', title: 'Video generation', outputUrl: asset.url },
    });
    return NextResponse.json({ status: 'completed', id, url: asset.url });
  } catch (error) {
    await markJobStatus({
      workspaceId: tenant.workspace.id,
      jobId,
      status: 'failed',
      error: { message: error?.message || 'OpenRouter request failed' },
    });
    const statusCode = Number.isInteger(error?.status) ? error.status : 502;
    return NextResponse.json({ error: error?.message || 'OpenRouter request failed', code: error?.code }, { status: statusCode });
  }
}
