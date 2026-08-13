import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../src/services/tenantContext.js';
import { createAssetUpload, listWorkspaceAssets } from '../../../src/services/assetService.js';

function workspaceId(request) {
  return request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace_id');
}

function errorResponse(error) {
  const status = error.status || (error.message === 'Authentication required' ? 401 : error.message === 'Workspace access denied' ? 403 : 400);
  return NextResponse.json({ error: error.message }, { status });
}

export async function GET(request) {
  try {
    const id = workspaceId(request);
    if (!id) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
    const tenant = await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId: id });
    return NextResponse.json({ assets: await listWorkspaceAssets(tenant.workspace.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const id = workspaceId(request);
    if (!id) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
    const tenant = await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId: id });
    return NextResponse.json(await createAssetUpload(tenant.workspace.id, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
