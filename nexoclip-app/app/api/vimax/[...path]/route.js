// Reverse proxy to the standalone AI Storyboard (ViMax) service. The service
// (nexoclip-app/services/vimax/web/server.mjs) owns the Python agent process, session
// state, and artifacts; this app only forwards /api/vimax/* -> <service>/api/*.
//
// Same code path in dev and in Docker — only VIMAX_SERVICE_URL changes.
import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { getCurrentSession } from '../../../../src/services/authService.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVICE_URL = (process.env.VIMAX_SERVICE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');

// Identifies the calling user to the AI Storyboard service so it can isolate each
// tenant's agent, events, and project data. The service strips any client-supplied
// value and trusts only what this authenticated proxy sets.
const TENANT_HEADER = 'x-nexoclip-tenant';
const TENANT_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

// Headers worth passing back to the browser (SSE, binary, JSON all covered).
const PASS_THROUGH = ['content-type', 'cache-control', 'content-length', 'content-disposition', 'x-accel-buffering'];

async function proxy(request, ctx) {
  // AI Storyboard is behind login — resolve the tenant from the session cookie.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await getCurrentSession(token);
  if (!session) {
    return Response.json({error: 'Not authenticated'}, {status: 401});
  }

  const tenantId = String(session.user_id || '').trim();
  if (!TENANT_PATTERN.test(tenantId)) {
    return Response.json({error: 'Invalid authenticated tenant'}, {status: 401});
  }

  const {path = []} = await ctx.params;
  const {search} = new URL(request.url);
  const target = `${SERVICE_URL}/api/${path.join('/')}${search}`;

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const init = {
    method: request.method,
    headers: {[TENANT_HEADER]: tenantId},
    // Stream the request body through (JSON messages and multipart uploads alike).
    ...(hasBody ? {body: request.body, duplex: 'half'} : {}),
    redirect: 'manual',
  };
  const contentType = request.headers.get('content-type');
  if (contentType) init.headers['content-type'] = contentType;

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    return Response.json({error: `AI Storyboard service unreachable: ${error.message}`}, {status: 502});
  }

  const headers = new Headers();
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // The service already streams SSE/binary; hand its body straight to the client.
  return new Response(upstream.body, {status: upstream.status, headers});
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
