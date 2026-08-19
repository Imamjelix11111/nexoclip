import { NextResponse } from 'next/server.js';
import { SESSION_COOKIE } from '../../../src/lib/auth/session.js';
import { getCurrentSession } from '../../../src/services/authService.js';
import { getDefaultWorkspace } from '../../../src/services/workspaceService.js';
import { getPool } from '../../../src/db/pool.js';
import { listJobs as listJobsService } from '../../../src/services/jobService.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function createJobsListHandler({
  getSession = getCurrentSession, getWorkspace = getDefaultWorkspace,
  listJobs = listJobsService, pool = getPool(),
} = {}) {
  return async function GET(request) {
    const session = await getSession(request.cookies?.get(SESSION_COOKIE)?.value);
    if (!session?.user_id) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const workspace = await getWorkspace(session.user_id);
    if (!workspace?.id) return NextResponse.json({ error: 'No workspace is available' }, { status: 403 });

    const url = new URL(request.url);
    const statuses = url.searchParams.get('status') === 'active' ? ['queued', 'running'] : null;
    const { jobs } = await listJobs({ pool, workspaceId: workspace.id, statuses });
    return NextResponse.json({ jobs });
  };
}

export const GET = createJobsListHandler();
