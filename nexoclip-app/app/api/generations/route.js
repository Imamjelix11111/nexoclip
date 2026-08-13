import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../src/services/tenantContext.js';
import { createImageGenerationJobWithReservation } from '../../../src/services/generationService.js';

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

export async function POST(request) {
  try {
    const tenant = await context(request);
    const input = await request.json();
    const idempotencyKey = input.idempotencyKey || request.headers.get('idempotency-key');
    return NextResponse.json({ generation: await createImageGenerationJobWithReservation(
      (await import('../../../src/db/pool.js')).getPool(),
      tenant.workspace.id,
      { ...input, idempotencyKey },
    ) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
