import { SESSION_COOKIE } from '../../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../../src/services/tenantContext.js';
import { createAssetDownload, createStorage } from '../../../../../src/services/assetService.js';

function errorResponse(error) {
  const status = error.status || (error.message === 'Authentication required' ? 401 : error.message === 'Workspace access denied' ? 403 : 400);
  return Response.json({ error: error.message }, { status });
}

export async function GET(request, { params }) {
  try {
    const workspaceId = request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
    const tenant = await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId });
    const { assetId } = await params;
    const result = await createAssetDownload(tenant.workspace.id, assetId);
    if (!result) return Response.json({ error: 'Asset not found' }, { status: 404 });
    const object = await createStorage().get(result.download.url);
    return new Response(object.body, { headers: { 'Content-Type': object.contentType, 'Cache-Control': 'private, max-age=31536000, immutable', 'Vary': 'Cookie' } });
  } catch (error) { return errorResponse(error); }
}
