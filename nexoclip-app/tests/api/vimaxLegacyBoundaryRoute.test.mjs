import test from 'node:test';
import assert from 'node:assert/strict';

import { createLegacyVimaxProxyHandler } from '../../app/api/vimax/[...path]/route.js';

function request(method, path) {
  const value = method === 'GET' ? undefined : '{}';
  const request = new Request(`http://localhost/api/vimax/${path}`, { method, body: value });
  request.cookies = { get: () => ({ value: 'session-token' }) };
  return request;
}

function handler(fetchCalls) {
  return createLegacyVimaxProxyHandler({
    getSession: async () => ({ user_id: 'user-1' }),
    getWorkspace: async () => ({ id: 'workspace-1' }),
    fetchFn: async (...args) => {
      fetchCalls.push(args);
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    },
  });
}

test('blocks legacy GET browsing routes without forwarding to the FastAPI runtime', async () => {
  const calls = [];
  const GET = handler(calls);
  const response = await GET(request('GET', 'sessions'), { params: Promise.resolve({ path: ['sessions'] }) });

  assert.equal(response.status, 410);
  assert.equal(calls.length, 0);
});

test('returns 410 for every legacy write before contacting upstream', async () => {
  const calls = [];
  const POST = handler(calls);
  const response = await POST(request('POST', 'agent/start'), { params: Promise.resolve({ path: ['agent', 'start'] }) });

  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { error: 'Legacy ViMax writes are no longer available. Use durable storyboard jobs.' });
  assert.equal(calls.length, 0);
});

test('returns 404 for unknown legacy GET routes before contacting upstream', async () => {
  const calls = [];
  const GET = handler(calls);
  const response = await GET(request('GET', 'agent/events'), { params: Promise.resolve({ path: ['agent', 'events'] }) });

  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
});
