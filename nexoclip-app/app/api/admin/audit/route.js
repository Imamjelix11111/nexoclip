import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../src/services/tenantContext.js';
import { adminAuditService } from '../../../../src/services/adminAuditService.js';

function errorResponse(error) { const status = error.status || (error.message === 'Authentication required' ? 401 : error.message === 'Workspace access denied' ? 403 : 400); return NextResponse.json({ error: error.message, code: error.code }, { status }); }
function workspaceId(request) { return request.headers.get('x-workspace-id') || new URL(request.url).searchParams.get('workspace_id'); }
export async function GET(request) {
  try {
    const url = new URL(request.url); const id = workspaceId(request);
    if (!id) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
    const tenant = await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId: id });
    const type = url.searchParams.get('type') || 'jobs';
    const filters = Object.fromEntries(url.searchParams.entries());
    const args = { workspaceId: tenant.workspace.id, role: tenant.workspace.role, filters };
    const data = type === 'usage' ? await adminAuditService.listUsage(args) : type === 'credits' ? await adminAuditService.listCredits(args) : type === 'jobs' ? await adminAuditService.listJobs(args) : null;
    if (!data) return NextResponse.json({ error: 'Invalid audit type' }, { status: 400 });
    return NextResponse.json(data);
  } catch (error) { return errorResponse(error); }
}
