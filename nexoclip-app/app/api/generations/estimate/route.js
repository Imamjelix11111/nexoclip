import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../../src/services/tenantContext.js';
import { estimateCostForOperation } from '../../../../src/services/pricingService.js';
import { getPool } from '../../../../src/db/pool.js';

function errorResponse(error) {
  const status = error.status || (error.message === 'Authentication required' ? 401 : error.message === 'Workspace access denied' ? 403 : 400);
  return Response.json({ error: error.message, code: error.code }, { status });
}

function input(body) {
  const operation = String(body?.operation || '').trim();
  const quantity = Number(body?.quantity);
  const pricingVersion = body?.pricingVersion ?? null;
  if (!operation || operation.length > 120) throw Object.assign(new Error('operation is invalid'), { status: 400 });
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) throw Object.assign(new Error('quantity is invalid'), { status: 400 });
  if (pricingVersion !== null && (!Number.isSafeInteger(pricingVersion) || pricingVersion < 1)) throw Object.assign(new Error('pricingVersion is invalid'), { status: 400 });
  return { operation, quantity, pricingVersion };
}

export function createGenerationEstimateHandler({ resolveContext = resolveTenantContext, estimate = estimateCostForOperation, pool = null } = {}) {
  return async function POST(request) {
    try {
      const workspaceId = request.headers.get('x-workspace-id');
      if (!workspaceId) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
      await resolveContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId });
      return Response.json({ estimate: await estimate(pool || getPool(), input(await request.json())) });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createGenerationEstimateHandler();
