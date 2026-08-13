import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../src/services/tenantContext.js';
import {
  getProject,
  removeWorkspaceProject,
  updateWorkspaceProject,
} from '../../../../src/services/projectService.js';

async function context(request, workspaceId) {
  if (!workspaceId) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
  return resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId });
}

function response(error) {
  const status = error.status || (error.message === 'Authentication required' ? 401 : error.message === 'Workspace access denied' ? 403 : 400);
  return NextResponse.json({ error: error.message }, { status });
}

export async function GET(request, { params }) {
  try {
    const workspaceId = request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace_id');
    const tenant = await context(request, workspaceId);
    const project = await getProject(tenant.workspace.id, params.projectId);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error) { return response(error); }
}

export async function PATCH(request, { params }) {
  try {
    const workspaceId = request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace_id');
    const tenant = await context(request, workspaceId);
    const project = await updateWorkspaceProject(tenant.workspace.id, params.projectId, await request.json());
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error) { return response(error); }
}

export async function DELETE(request, { params }) {
  try {
    const workspaceId = request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace_id');
    const tenant = await context(request, workspaceId);
    const deleted = await removeWorkspaceProject(tenant.workspace.id, params.projectId);
    if (!deleted) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) { return response(error); }
}
