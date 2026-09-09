import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { getCurrentSession } from '../../../../src/services/authService.js';
import { getDefaultWorkspace } from '../../../../src/services/workspaceService.js';
import { getPool } from '../../../../src/db/pool.js';
import { getJob as getJobService } from '../../../../src/services/jobService.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function createJobGetHandler({
  getSession = getCurrentSession,
  getWorkspace = getDefaultWorkspace,
  getJob = getJobService,
  pool,
  poolFactory = getPool,
} = {}) {
  return async function GET(request, { params }) {
    const session = await getSession(request.cookies?.get(SESSION_COOKIE)?.value);
    if (!session?.user_id) return Response.json({ error: 'Not authenticated' }, { status: 401 });
    const workspace = await getWorkspace(session.user_id);
    if (!workspace?.id) return Response.json({ error: 'No workspace is available' }, { status: 403 });

    const { id } = await params;
    const resolvedPool = pool ?? poolFactory();
    const job = await getJob({ pool: resolvedPool, workspaceId: workspace.id, id });
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });
    return Response.json({ job });
  };
}

export const GET = createJobGetHandler();
