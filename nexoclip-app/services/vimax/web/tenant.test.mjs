import {describe, expect, it} from 'vitest';
import {isValidTenantId, tenantIdFromRequest, tenantRoot} from './tenant.mjs';

describe('tenant identity', () => {
  it('accepts a safe tenant header', () => {
    const request = {headers: {'x-nexoclip-tenant': 'user_123'}};
    expect(tenantIdFromRequest(request, {production: true})).toBe('user_123');
  });

  it('rejects missing tenant in production', () => {
    expect(() => tenantIdFromRequest({headers: {}}, {production: true}))
      .toThrow(expect.objectContaining({statusCode: 401}));
  });

  it('keeps default fallback only outside production', () => {
    expect(tenantIdFromRequest({headers: {}}, {production: false})).toBe('default');
  });

  it('rejects traversal and malformed values before path resolution', () => {
    expect(isValidTenantId('../other')).toBe(false);
    expect(() => tenantIdFromRequest({headers: {'x-nexoclip-tenant': '../other'}}, {production: true}))
      .toThrow(expect.objectContaining({statusCode: 401}));
    expect(() => tenantRoot('/repo', '../other')).toThrow(expect.objectContaining({statusCode: 401}));
  });
});
