import test from 'node:test';
import assert from 'node:assert/strict';

import { createVimaxJobStatusHandler } from '../../app/api/vimax/jobs/[generationId]/route.js';

function request() {
  const request = new Request('http://localhost/api/vimax/jobs/job-1', { method: 'GET', headers: { 'x-workspace-id': 'attacker-workspace' } });
  request.cookies = { get: (name) => name === 'nexoclip_session' ? { value: 'session-token' } : undefined };
  return request;
}

test('loads job status from the authenticated user default workspace, ignoring client workspace headers', async () => {
  const calls = [];
  const GET = createVimaxJobStatusHandler({
    getSession: async (token) => {
      calls.push(['session', token]);
      return { user_id: 'user-1' };
    },
    getWorkspace: async (userId) => {
      calls.push(['workspace', userId]);
      return { id: 'workspace-server-derived' };
    },
    getJob: async (workspaceId, generationId) => {
      calls.push(['job', workspaceId, generationId]);
      return { id: generationId, status: 'running' };
    },
  });

  const response = await GET(request(), { params: Promise.resolve({ generationId: 'job-1' }) });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { generation: { id: 'job-1', status: 'running' } });
  assert.deepEqual(calls, [
    ['session', 'session-token'],
    ['workspace', 'user-1'],
    ['job', 'workspace-server-derived', 'job-1'],
  ]);
});

test('returns persisted progress and completion result from the durable job record', async () => {
  const GET = createVimaxJobStatusHandler({
    getSession: async () => ({user_id: 'user-1'}), getWorkspace: async () => ({id: 'workspace-1'}),
    getJob: async () => ({id: 'job-1', status: 'succeeded', progress: {stage: 'rendering'}, result: {generated: ['clip.mp4']}}),
  });
  const response = await GET(request(), {params: Promise.resolve({generationId: 'job-1'})});
  assert.deepEqual(await response.json(), {generation: {id: 'job-1', status: 'succeeded', progress: {stage: 'rendering'}, result: {generated: ['clip.mp4']}}});
});

test('rejects unauthenticated status access', async () => {
  const GET = createVimaxJobStatusHandler({ getSession: async () => null });
  const response = await GET(request(), { params: Promise.resolve({ generationId: 'job-1' }) });
  assert.equal(response.status, 401);
});
