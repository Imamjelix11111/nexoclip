process.env.DATABASE_URL ||= 'postgres://test:test@localhost/test';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageGetHandler } from '../../app/api/usage/route.js';

function request(url, workspaceId = 'w1') {
  const req = new Request(url, { headers: { 'x-workspace-id': workspaceId } });
  req.cookies = { get: () => ({ value: 'session-token' }) };
  return req;
}

test('usage route derives user and role from tenant context', async () => {
  let received;
  const handler = createUsageGetHandler({
    resolveContext: async () => ({ user: { id: 'u1' }, workspace: { id: 'w1', role: 'member' } }),
    service: { getUsage: async (args) => { received = args; return { balance: '8', items: [] }; } },
  });
  const response = await handler(request('http://app/api/usage?scope=me&page=2'));
  assert.equal(response.status, 200);
  assert.equal(received.userId, 'u1');
  assert.equal(received.workspaceId, 'w1');
  assert.equal(received.role, 'member');
  assert.equal(received.page, '2');
});

test('usage route requires a workspace selection', async () => {
  const handler = createUsageGetHandler({ resolveContext: async () => null, service: { getUsage: async () => ({}) } });
  const response = await handler(request('http://app/api/usage', ''));
  assert.equal(response.status, 400);
});

test('usage route maps authentication, membership, and scope errors safely', async () => {
  for (const [error, status] of [
    [new Error('Authentication required'), 401],
    [new Error('Workspace access denied'), 403],
    [Object.assign(new Error('Workspace usage requires administrator access'), { status: 403, code: 'WORKSPACE_USAGE_FORBIDDEN' }), 403],
  ]) {
    const handler = createUsageGetHandler({
      resolveContext: async () => { throw error; },
      service: { getUsage: async () => ({}) },
    });
    const response = await handler(request('http://app/api/usage'));
    assert.equal(response.status, status);
  }
});
