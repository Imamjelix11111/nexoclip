import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../../src/services/tenantContext.js';
import { createAssetDownload } from '../../../../../src/services/assetService.js';

export async function GET(request, { params }) {
  try {
    const workspaceId = request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
    const tenant = await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId });
    const result = await createAssetDownload(tenant.workspace.id, params.assetId);
    if (!result) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const status = error.status || (error.message === 'Authentication required' ? 401 : error.message === 'Workspace access denied' ? 403 : 400);
    return NextResponse.json({ error: error.message }, { status });
  }
}
