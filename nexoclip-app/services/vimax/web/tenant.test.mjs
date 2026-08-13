import {describe, expect, it} from 'vitest';
import {isValidTenantId, tenantIdFromRequest, tenantRoot, workspaceIdFromRequest} from './tenant.mjs';

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('workspace tenant identity', () => {
  it('uses the trusted workspace UUID as the ViMax tenant identity', () => {
    const request = {headers: {'x-nexoclip-workspace': workspaceId}};
    expect(workspaceIdFromRequest(request, {production: true})).toBe(workspaceId);
    expect(tenantRoot('/repo', workspaceId)).toBe(`/repo/.tenants/${workspaceId}`);
  });

  it('rejects missing or malformed workspace identity in production', () => {
    expect(() => workspaceIdFromRequest({headers: {}}, {production: true}))
      .toThrow(expect.objectContaining({statusCode: 401}));
    expect(() => workspaceIdFromRequest({headers: {'x-nexoclip-workspace': '../other'}}, {production: true}))
      .toThrow(expect.objectContaining({statusCode: 401}));
  });

  it('retains a development fallback only outside production', () => {
    expect(workspaceIdFromRequest({headers: {}}, {production: false})).toBe('');
    expect(tenantIdFromRequest({headers: {}}, {production: false})).toBe('default');
  });

  it('still validates generic tenant path components', () => {
    expect(isValidTenantId('../other')).toBe(false);
    expect(() => tenantIdFromRequest({headers: {'x-nexoclip-tenant': '../other'}}, {production: true}))
      .toThrow(expect.objectContaining({statusCode: 401}));
  });
});
