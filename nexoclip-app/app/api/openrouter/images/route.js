import { createOpenRouterImageAdapter } from '../../../../src/providers/openrouter/imageAdapter.js';
import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../src/services/tenantContext.js';
import { persistGeneratedImage } from '../../../../src/services/generatedImageService.js';
import { getPool } from '../../../../src/db/pool.js';
import { createJob as createJobService, updateJobStatus as updateJobStatusService } from '../../../../src/services/jobService.js';

export function createImageHandler({
  resolveTenant = resolveTenantContext,
  env = process.env,
  generate = (params) => createOpenRouterImageAdapter({ apiKey: env.OPENROUTER_API_KEY }).generate(params),
  persist = persistGeneratedImage,
  createJob = createJobService,
  updateJobStatus = updateJobStatusService,
  pool,
} = {}) {
  return async function POST(request) {
    if (!env.OPENROUTER_API_KEY) {
      return Response.json({ error: 'OpenRouter is not configured' }, { status: 503 });
    }
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    if (!body?.model || !body?.prompt) {
      return Response.json({ error: 'model and prompt are required' }, { status: 400 });
    }
    let tenant;
    try {
      const workspaceId = request.headers.get('x-workspace-id');
      if (!workspaceId) return Response.json({ error: 'x-workspace-id is required' }, { status: 400 });
      tenant = await resolveTenant({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId });
    } catch (error) {
      return Response.json({ error: error.message }, { status: error.message === 'Authentication required' ? 401 : 403 });
    }
    try {
      const result = await generate({
        model: body.model,
        prompt: body.prompt,
        aspectRatio: body.aspect_ratio,
        resolution: body.resolution,
        quality: body.quality,
        seed: body.seed,
        referenceImages: (body.input_references || []).map((item) => item?.image_url?.url).filter(Boolean),
      });
      const outputs = await Promise.all(result.outputs.map(async (output) => ({
        ...(await persist({ workspaceId: tenant.workspace.id, dataUrl: output.url })),
        mimeType: output.mimeType,
      })));

      let job = null;
      try {
        job = await createJob({
          // Lazily resolved: only touched by consumers that actually read it, so
          // an injected createJob (tests) never forces a real DB pool to exist.
          get pool() { return pool ?? getPool(); },
          workspaceId: tenant.workspace.id,
          kind: 'image',
          params: { model: body.model, prompt: body.prompt },
        });
        await updateJobStatus({
          get pool() { return pool ?? getPool(); },
          workspaceId: tenant.workspace.id,
          id: job.id,
          status: 'succeeded',
          result: {
            kind: 'image',
            title: 'Image generation',
            outputUrl: outputs[0]?.url ?? null,
            thumbnailUrl: outputs[0]?.url ?? null,
          },
        });
      } catch {
        // Job tracking is best-effort; never let it break the image response.
      }

      return Response.json({ ...result, outputs, job_id: job?.id ?? null });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 502;
      return Response.json({ error: error?.message || 'OpenRouter request failed', code: error?.code }, { status });
    }
  };
}

export const POST = createImageHandler();
