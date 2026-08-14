// Reverse proxy to the standalone AI Storyboard (ViMax) service. The service
// (nexoclip-app/services/vimax/web/server.mjs) owns the Python agent process, session
// state, and artifacts; this app only forwards /api/vimax/* -> <service>/api/*.
//
// Same code path in dev and in Docker — only VIMAX_SERVICE_URL changes.
import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { getCurrentSession } from '../../../../src/services/authService.js';
import { getDefaultWorkspace } from '../../../../src/services/workspaceService.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEGACY_READ_PATHS = new Set();
const LEGACY_WRITE_MESSAGE = 'Legacy ViMax writes are no longer available. Use durable storyboard jobs.';

export function createLegacyVimaxProxyHandler({
  getSession = getCurrentSession,
  getWorkspace = getDefaultWorkspace,
  fetchFn = fetch,
} = {}) {
  return async function proxy(request, ctx) {
  if (request.method !== 'GET') {
    return Response.json({error: LEGACY_WRITE_MESSAGE}, {status: 410});
  }

  const {path = []} = await ctx.params;
  const route = path.join('/');
  if (!LEGACY_READ_PATHS.has(route)) {
    return Response.json({error: route === 'sessions' ? 'Legacy ViMax browsing is unavailable during the durable-job migration.' : 'Legacy ViMax route not found'}, {status: route === 'sessions' ? 410 : 404});
  }
  return Response.json({error: 'Legacy ViMax browsing is unavailable during the durable-job migration.'}, {status: 410});
  };
}

const proxy = createLegacyVimaxProxyHandler();
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
