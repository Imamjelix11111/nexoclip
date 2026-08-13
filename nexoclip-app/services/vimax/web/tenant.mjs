import path from 'node:path';

export const TENANT_HEADER = 'x-nexoclip-tenant';
export const WORKSPACE_HEADER = 'x-nexoclip-workspace';
const TENANT_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const WORKSPACE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidTenantId(value) {
  return typeof value === 'string' && TENANT_PATTERN.test(value);
}

export function tenantIdFromRequest(request, {production = process.env.NODE_ENV === 'production'} = {}) {
  const raw = String(request?.headers?.[TENANT_HEADER] || '').trim();
  if (isValidTenantId(raw)) return raw;
  if (!production && !raw) return 'default';

  const error = new Error('Valid tenant identity is required');
  error.statusCode = 401;
  throw error;
}

export function workspaceIdFromRequest(request, {production = process.env.NODE_ENV === 'production'} = {}) {
  const value = String(request?.headers?.[WORKSPACE_HEADER] || '').trim();
  if (WORKSPACE_PATTERN.test(value)) return value;
  if (!production && !value) return '';
  const error = new Error('Valid workspace identity is required');
  error.statusCode = 401;
  throw error;
}

export function tenantRoot(repoRoot, tenantId) {
  if (!isValidTenantId(tenantId)) {
    const error = new Error('Invalid tenant identity');
    error.statusCode = 401;
    throw error;
  }
  return path.join(repoRoot, '.tenants', tenantId);
}
