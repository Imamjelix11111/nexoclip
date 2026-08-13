import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveTenantContext } from '../../src/services/tenantContext.js';
import { createAdminAuditService } from '../../src/services/adminAuditService.js';
import { createAssetDownload } from '../../src/services/assetService.js';
import { LocalObjectStorage } from '../../src/storage/localObjectStorage.js';
import { createBillingWebhookService } from '../../src/services/billingService.js';
import { createMuapiAdapter } from '../../src/providers/muapi/adapter.js';
import { sessionCookieOptions } from '../../src/lib/auth/session.js';
import { findGenerationByIdempotencyKey } from '../../src/repositories/generationRepository.js';

function fakePool() {
  const calls = [];
  return {
    calls,
    async connect() {
      return {
        async query(text, values) {
          calls.push({ text, values });
          return { rows: [{ id: 'event-1', status: 'pending' }] };
        },
        release() {},
      };
    },
  };
}

test('denies a session user from a workspace where membership is absent', async () => {
  await assert.rejects(
    () => resolveTenantContext({
      token: 'session-a',
      workspaceId: 'workspace-b',
      sessionLookup: async () => ({ user_id: 'user-a' }),
      membershipLookup: async () => null,
    }),
    { message: 'Workspace access denied' },
  );
});

test('preserves membership roles and denies non-admin audit access before repository calls', async () => {
  let queried = false;
  const tenant = await resolveTenantContext({
    token: 'session-a',
    workspaceId: 'workspace-a',
    sessionLookup: async () => ({ user_id: 'user-a', email: 'a@example.com' }),
    membershipLookup: async () => ({ id: 'workspace-a', user_id: 'user-a', role: 'member' }),
  });
  const service = createAdminAuditService({ repositories: {
    listGenerationJobs: async () => { queried = true; return { rows: [], total: 0 }; },
  } });

  assert.equal(tenant.workspace.role, 'member');
  await assert.rejects(() => service.listJobs({ workspaceId: tenant.workspace.id, role: tenant.workspace.role, filters: {} }), { status: 403 });
  assert.equal(queried, false);
});

test('scopes idempotency lookup to the requesting workspace', async () => {
  const calls = [];
  await findGenerationByIdempotencyKey({
    async query(text, values) { calls.push({ text, values }); return { rows: [] }; },
  }, 'workspace-a', 'same-key');
  assert.match(calls[0].text, /workspace_id = \$1 AND idempotency_key = \$2/);
  assert.deepEqual(calls[0].values, ['workspace-a', 'same-key']);
});

test('does not issue an asset lookup without a tenant scope', async () => {
  await assert.rejects(
    () => createAssetDownload('', 'asset-a', { createDownloadUrl: async () => ({}) }),
    /workspace_id is required/,
  );
});

test('signed asset URLs reject tampering and expiry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexoclip-security-'));
  try {
    const storage = new LocalObjectStorage({ root, secret: 'test-secret' });
    const signed = await storage.createDownloadUrl({ key: 'workspace-a/asset-a', expiresInSeconds: 60 });
    await storage.put((await storage.createUploadUrl({ key: 'workspace-a/asset-a' })).url, Buffer.from('asset'), 'image/png');
    await assert.rejects(() => storage.get(signed.url.replace(/signature=[^&]+/, 'signature=tampered')), /Invalid|expired/);
    const expired = await storage.createDownloadUrl({ key: 'workspace-a/asset-a', expiresInSeconds: -1 });
    await assert.rejects(() => storage.get(expired.url), /expired/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('production session cookies are HttpOnly, Secure, SameSite, and path scoped', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.deepEqual(sessionCookieOptions(), { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('provider adapter never discloses the provider secret in errors', async () => {
  const secret = 'muapi-secret-must-not-leak';
  const adapter = createMuapiAdapter({ apiKey: secret, fetch: async () => { throw new Error(`upstream included ${secret}`); } });
  await assert.rejects(() => adapter.getGenerationStatus('request-a'), (error) => {
    assert.equal(error.message.includes(secret), false);
    return error.code === 'PROVIDER_REQUEST_FAILED';
  });
});

test('rejects an invalid webhook signature before opening or writing a transaction', async () => {
  const pool = fakePool();
  const service = createBillingWebhookService({ pool, verifier: async () => false, handler: async () => {} });
  await assert.rejects(() => service.receive({ providerKey: 'development', eventId: 'evt-a', rawBody: '{}', signature: 'bad' }), /Invalid webhook signature/);
  assert.equal(pool.calls.length, 0);
});
