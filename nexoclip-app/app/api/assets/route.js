import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../src/services/tenantContext.js';
import { getCurrentSession } from '../../../src/services/authService.js';
import { getDefaultWorkspace } from '../../../src/services/workspaceService.js';
import { createAssetUpload, listWorkspaceAssets } from '../../../src/services/assetService.js';

async function workspaceId(request) {
  const requested = request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace_id');
  if (requested) return requested;

  const session = await getCurrentSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const workspace = await getDefaultWorkspace(session.user_id);
  if (!workspace) throw Object.assign(new Error('Workspace access denied'), { status: 403 });
  return workspace.id;
}

function errorResponse(error) {
  const status = error.status || (error.message === 'Authentication required' ? 401 : error.message === 'Workspace access denied' ? 403 : 400);
  return NextResponse.json({ error: error.message }, { status });
}

export async function GET(request) {
  try {
    const id = await workspaceId(request);
    const tenant = await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId: id });
    const assets = await listWorkspaceAssets(tenant.workspace.id);
    // Spite's Canvas asset panel predates durable workspace assets and expects
    // generation-history names. Provide that display contract while retaining
    // the canonical asset fields used by the main Studio.
    return NextResponse.json({
      assets: assets.map((asset) => ({
        ...asset,
        type: asset.content_type?.startsWith('video/') ? 'video' : asset.content_type?.startsWith('audio/') ? 'audio' : 'image',
        model: 'generation',
        prompt: asset.filename,
        r2_url: asset.url,
        used_in_canvas: true,
        is_upload: false,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const id = await workspaceId(request);
    const tenant = await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId: id });
    return NextResponse.json(await createAssetUpload(tenant.workspace.id, await request.json()), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
