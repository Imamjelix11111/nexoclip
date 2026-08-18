import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { getCurrentSession } from '../../../../src/services/authService.js';
import { getDefaultWorkspace } from '../../../../src/services/workspaceService.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function createVimaxSessionsHandler({getSession = getCurrentSession, getWorkspace = getDefaultWorkspace, fetchFn = fetch, env = process.env} = {}) {
  async function authorize(request) {
    const token = request.cookies?.get(SESSION_COOKIE)?.value;
    const session = await getSession(token);
    if (!session?.user_id) return {error: Response.json({error: 'Not authenticated'}, {status: 401})};
    const workspace = await getWorkspace(session.user_id);
    if (!workspace?.id) return {error: Response.json({error: 'No workspace is available'}, {status: 403})};
    if (!env.VIMAX_RUNTIME_URL || !env.VIMAX_RUNTIME_TOKEN) return {error: Response.json({error: 'Storyboard runtime is unavailable'}, {status: 503})};
    return {workspace};
  }

  async function GET(request) {
    const {error, workspace} = await authorize(request);
    if (error) return error;
    const url = new URL(`${env.VIMAX_RUNTIME_URL.replace(/\/$/, '')}/internal/v1/sessions`);
    url.search = new URLSearchParams({workspace_id: workspace.id}).toString();
    let response;
    try {
      response = await fetchFn(url.toString(), {
        method: 'GET', headers: {'X-NexoClip-Runtime-Token': env.VIMAX_RUNTIME_TOKEN},
      });
    } catch {
      return Response.json({error: 'Unable to list storyboard projects'}, {status: 502});
    }
    if (!response.ok) return Response.json({error: 'Unable to list storyboard projects'}, {status: 502});
    return Response.json(await response.json(), {status: 200});
  }

  async function POST(request) {
    const {error, workspace} = await authorize(request);
    if (error) return error;
    let projectName = '';
    try { projectName = String((await request.json()).projectName || '').slice(0, 64); } catch {}
    let response;
    try {
      response = await fetchFn(`${env.VIMAX_RUNTIME_URL.replace(/\/$/, '')}/internal/v1/sessions`, {
        method: 'POST', headers: {'Content-Type': 'application/json', 'X-NexoClip-Runtime-Token': env.VIMAX_RUNTIME_TOKEN},
        body: JSON.stringify({workspace_id: workspace.id, project_name: projectName}),
      });
    } catch {
      return Response.json({error: 'Unable to create storyboard project'}, {status: 502});
    }
    if (!response.ok) return Response.json({error: 'Unable to create storyboard project'}, {status: 502});
    return Response.json(await response.json(), {status: 201});
  }

  return async function handler(request) {
    if (request.method === 'GET') return GET(request);
    if (request.method === 'POST') return POST(request);
    return Response.json({error: 'Method not allowed'}, {status: 405});
  };
}

const handler = createVimaxSessionsHandler();
export const GET = handler;
export const POST = handler;
