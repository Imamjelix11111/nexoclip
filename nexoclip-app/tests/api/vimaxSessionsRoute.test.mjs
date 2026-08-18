import test from 'node:test';
import assert from 'node:assert/strict';

import { createVimaxSessionsHandler } from '../../app/api/vimax/sessions/route.js';

function getRequest(headers = {}) {
  const request = new Request('http://app/api/vimax/sessions', {
    method: 'GET',
    headers: { 'x-workspace-id': 'attacker-workspace', ...headers },
  });
  request.cookies = { get: (name) => name === 'nexoclip_session' ? { value: 'session-token' } : undefined };
  return request;
}

function postRequest(body) {
  const request = new Request('http://app/api/vimax/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-workspace-id': 'attacker-workspace' },
    body: JSON.stringify(body),
  });
  request.cookies = { get: (name) => name === 'nexoclip_session' ? { value: 'session-token' } : undefined };
  return request;
}

test('lists durable sessions using the authenticated workspace only', async () => {
  const handler = createVimaxSessionsHandler({
    getSession: async () => ({ user_id: 'user-1' }),
    getWorkspace: async () => ({ id: 'workspace-server' }),
    env: { VIMAX_RUNTIME_URL: 'http://runtime', VIMAX_RUNTIME_TOKEN: 'secret' },
    fetchFn: async (url, init) => {
      assert.equal(url, 'http://runtime/internal/v1/sessions?workspace_id=workspace-server');
      assert.equal(init.headers['X-NexoClip-Runtime-Token'], 'secret');
      return Response.json({ sessions: [{ sessionId: 's-1', projectName: 'Trailer' }] });
    },
  });
  const response = await handler(getRequest());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sessions[0].sessionId, 's-1');
});

test('rejects unauthenticated session listing', async () => {
  const handler = createVimaxSessionsHandler({
    getSession: async () => null,
    getWorkspace: async () => { throw new Error('should not be called'); },
    env: { VIMAX_RUNTIME_URL: 'http://runtime', VIMAX_RUNTIME_TOKEN: 'secret' },
    fetchFn: async () => { throw new Error('should not be called'); },
  });
  const response = await handler(getRequest());
  assert.equal(response.status, 401);
});

test('returns 503 for listing when runtime configuration is absent', async () => {
  const handler = createVimaxSessionsHandler({
    getSession: async () => ({ user_id: 'user-1' }),
    getWorkspace: async () => ({ id: 'workspace-server' }),
    env: {},
    fetchFn: async () => { throw new Error('should not be called'); },
  });
  const response = await handler(getRequest());
  assert.equal(response.status, 503);
});

test('returns 502 and never relays runtime details when the runtime catalog fetch fails', async () => {
  const handler = createVimaxSessionsHandler({
    getSession: async () => ({ user_id: 'user-1' }),
    getWorkspace: async () => ({ id: 'workspace-server' }),
    env: { VIMAX_RUNTIME_URL: 'http://runtime', VIMAX_RUNTIME_TOKEN: 'secret' },
    fetchFn: async () => Response.json({ error: 'boom' }, { status: 500 }),
  });
  const response = await handler(getRequest());
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.equal(body.includes('secret'), false);
  assert.equal(body.includes('http://runtime'), false);
});

test('returns 502 and never relays runtime details when the runtime catalog fetch rejects', async () => {
  const handler = createVimaxSessionsHandler({
    getSession: async () => ({ user_id: 'user-1' }),
    getWorkspace: async () => ({ id: 'workspace-server' }),
    env: { VIMAX_RUNTIME_URL: 'http://runtime', VIMAX_RUNTIME_TOKEN: 'secret' },
    fetchFn: async () => { throw new Error('getaddrinfo ENOTFOUND runtime at http://runtime'); },
  });
  const response = await handler(getRequest());
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.equal(body.includes('secret'), false);
  assert.equal(body.includes('http://runtime'), false);
});

test('creates a durable session using only the server-derived workspace and a bounded project name', async () => {
  const calls = [];
  const handler = createVimaxSessionsHandler({
    getSession: async () => ({ user_id: 'user-1' }),
    getWorkspace: async () => ({ id: 'workspace-server' }),
    env: { VIMAX_RUNTIME_URL: 'http://runtime', VIMAX_RUNTIME_TOKEN: 'secret' },
    fetchFn: async (url, init) => {
      calls.push([url, JSON.parse(init.body)]);
      return Response.json({ session_id: 'session-1' });
    },
  });
  const response = await handler(postRequest({ projectName: 'A'.repeat(200), workspaceId: 'attacker-workspace' }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { session_id: 'session-1' });
  assert.deepEqual(calls, [
    ['http://runtime/internal/v1/sessions', { workspace_id: 'workspace-server', project_name: 'A'.repeat(64) }],
  ]);
});

test('returns 502 and never relays runtime details when the session creation fetch rejects', async () => {
  const handler = createVimaxSessionsHandler({
    getSession: async () => ({ user_id: 'user-1' }),
    getWorkspace: async () => ({ id: 'workspace-server' }),
    env: { VIMAX_RUNTIME_URL: 'http://runtime', VIMAX_RUNTIME_TOKEN: 'secret' },
    fetchFn: async () => { throw new Error('connect ECONNREFUSED http://runtime'); },
  });
  const response = await handler(postRequest({ projectName: 'Trailer' }));
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.equal(body.includes('secret'), false);
  assert.equal(body.includes('http://runtime'), false);
});

test('rejects unauthenticated session creation', async () => {
  const handler = createVimaxSessionsHandler({
    getSession: async () => null,
    getWorkspace: async () => { throw new Error('should not be called'); },
    env: { VIMAX_RUNTIME_URL: 'http://runtime', VIMAX_RUNTIME_TOKEN: 'secret' },
    fetchFn: async () => { throw new Error('should not be called'); },
  });
  const response = await handler(postRequest({ projectName: 'Trailer' }));
  assert.equal(response.status, 401);
});

test('returns 503 for creation when runtime configuration is absent', async () => {
  const handler = createVimaxSessionsHandler({
    getSession: async () => ({ user_id: 'user-1' }),
    getWorkspace: async () => ({ id: 'workspace-server' }),
    env: {},
    fetchFn: async () => { throw new Error('should not be called'); },
  });
  const response = await handler(postRequest({ projectName: 'Trailer' }));
  assert.equal(response.status, 503);
});
