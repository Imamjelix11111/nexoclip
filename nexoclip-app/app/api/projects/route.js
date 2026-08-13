import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../src/services/tenantContext.js';
import { createWorkspaceProject, getProjects } from '../../../src/services/projectService.js';

function workspaceId(request) {
  return request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace_id');
}

async function context(request) {
  const id = workspaceId(request);
  if (!id) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
  return resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId: id });
}

function errorResponse(error) {
  const status = error.status || (error.message === 'Authentication required' ? 401 : error.message === 'Workspace access denied' ? 403 : 400);
  return NextResponse.json({ error: error.message }, { status });
}

export async function GET(request) {
  try {
    const tenant = await context(request);
    return NextResponse.json({ projects: await getProjects(tenant.workspace.id) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request) {
  try {
    const tenant = await context(request);
    const project = await createWorkspaceProject(tenant.workspace.id, await request.json());
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
