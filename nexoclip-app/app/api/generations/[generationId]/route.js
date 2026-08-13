import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../src/services/tenantContext.js';
import { getGenerationJob } from '../../../../src/services/generationService.js';
import { createStorage } from '../../../../src/services/assetService.js';

function workspaceId(request) {
  return request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace_id');
}

function errorResponse(error) {
  const status = error.status || (error.message === 'Authentication required' ? 401 : error.message === 'Workspace access denied' ? 403 : 400);
  return NextResponse.json({ error: error.message }, { status });
}

export async function GET(request, { params }) {
  try {
    const id = workspaceId(request);
    if (!id) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
    const tenant = await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId: id });
    const generation = await getGenerationJob(tenant.workspace.id, params.generationId, createStorage());
    if (!generation) return NextResponse.json({ error: 'Generation not found' }, { status: 404 });
    return NextResponse.json({ generation });
  } catch (error) { return errorResponse(error); }
}
