import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../src/services/tenantContext.js';
import { getPool } from '../../../../src/db/pool.js';
import { createJob as createJobService } from '../../../../src/services/jobService.js';

async function defaultSubmitClip(body, tenant, env) {
  let response;
  try {
    response = await fetch(`${env.AI_CLIP_RUNTIME_URL.replace(/\/$/, '')}/internal/v1/clip-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NexoClip-Runtime-Token': env.AI_CLIP_RUNTIME_TOKEN },
      body: JSON.stringify({
        video_url: body.video_url,
        num_clips: body.num_clips,
        aspect_ratio: body.aspect_ratio,
        topic_hint: typeof body.topic_hint === 'string' ? body.topic_hint.slice(0, 500) : '',
        workspace_id: tenant.workspace.id,
      }),
    });
  } catch {
    const error = new Error('Unable to submit clip job');
    error.status = 502;
    throw error;
  }
  if (!response.ok) {
    const error = new Error('Unable to submit clip job');
    error.status = 502;
    throw error;
  }
  return response.json();
}

export function createClipSubmitHandler({
  resolveTenant = resolveTenantContext,
  env = process.env,
  submitClip,
  createJob = createJobService,
  pool,
} = {}) {
  return async function POST(request) {
    if (!env.AI_CLIP_RUNTIME_URL || !env.AI_CLIP_RUNTIME_TOKEN) {
      return Response.json({ error: 'AI Clip runtime is unavailable' }, { status: 503 });
    }
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    if (!body?.video_url) return Response.json({ error: 'video_url is required' }, { status: 400 });

    let tenant;
    try {
      const workspaceId = request.headers.get('x-workspace-id');
      if (!workspaceId) return Response.json({ error: 'x-workspace-id is required' }, { status: 400 });
      tenant = await resolveTenant({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId });
    } catch (error) {
      return Response.json({ error: error.message }, { status: error.message === 'Authentication required' ? 401 : 403 });
    }

    let result;
    try {
      const submit = submitClip ?? ((b, t) => defaultSubmitClip(b, t, env));
      result = await submit(body, tenant);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 502;
      return Response.json({ error: error?.message || 'Unable to submit clip job' }, { status });
    }

    let jobId = null;
    try {
      const job = await createJob({
        // Lazily resolved: only touched by consumers that actually read it, so
        // an injected createJob (tests) never forces a real DB pool to exist.
        get pool() { return pool ?? getPool(); },
        workspaceId: tenant.workspace.id,
        kind: 'clipping',
        params: { pythonJobId: result.id, video_url: body.video_url, num_clips: body.num_clips, aspect_ratio: body.aspect_ratio },
      });
      jobId = job.id;
    } catch {
      // Best-effort: the clip is already running in the Python service even if
      // the durable job mirror fails to be created.
    }

    return Response.json({ id: result.id, job_id: jobId, status: 'queued' }, { status: 202 });
  };
}

export const POST = createClipSubmitHandler();
