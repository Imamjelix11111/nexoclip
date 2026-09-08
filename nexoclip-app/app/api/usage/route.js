import { SESSION_COOKIE } from '../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../src/services/tenantContext.js';
import { usageService } from '../../../src/services/usageService.js';

function errorResponse(error) {
  const status = error.status || (error.message === 'Authentication required' ? 401 : error.message === 'Workspace access denied' ? 403 : 400);
  return Response.json({ error: error.message, code: error.code }, { status });
}

export function createUsageGetHandler({ resolveContext = resolveTenantContext, service = usageService } = {}) {
  return async function GET(request) {
    try {
      const url = new URL(request.url);
      const workspaceId = request.headers.get('x-workspace-id') || url.searchParams.get('workspace_id');
      if (!workspaceId) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
      const tenant = await resolveContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId });
      const data = await service.getUsage({
        workspaceId: tenant.workspace.id,
        userId: tenant.user.id,
        role: tenant.workspace.role,
        scope: url.searchParams.get('scope') || 'me',
        page: url.searchParams.get('page') || undefined,
        pageSize: url.searchParams.get('pageSize') || undefined,
      });
      return Response.json(data);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const GET = createUsageGetHandler();
