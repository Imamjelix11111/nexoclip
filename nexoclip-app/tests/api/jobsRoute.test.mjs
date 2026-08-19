// nexoclip-app/tests/api/jobsRoute.test.mjs
process.env.DATABASE_URL ||= 'postgres://test:test@localhost/test';

import test from 'node:test';
import assert from 'node:assert/strict';

const { createJobsListHandler } = await import('../../app/api/jobs/route.js');
const { createJobGetHandler } = await import('../../app/api/jobs/[id]/route.js');

function req(url, headers = {}) {
  const request = new Request(url, { method: 'GET', headers });
  request.cookies = { get: (n) => (n === 'nexoclip_session' ? { value: 'tok' } : undefined) };
  return request;
}
const okSession = async () => ({ user_id: 'u1', email: 'a@b.c' });
const okWorkspace = async () => ({ id: 'ws-1' });

test('lists jobs for the authenticated workspace only', async () => {
  const handler = createJobsListHandler({
    getSession: okSession, getWorkspace: okWorkspace, pool: {},
    listJobs: async ({ workspaceId }) => {
      assert.equal(workspaceId, 'ws-1');
      return { jobs: [{ id: 'j1', kind: 'video', status: 'running' }] };
    },
  });
  const res = await handler(req('http://app/api/jobs'));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).jobs[0].id, 'j1');
});

test('active filter maps to queued+running', async () => {
  let seen;
  const handler = createJobsListHandler({
    getSession: okSession, getWorkspace: okWorkspace, pool: {},
    listJobs: async ({ statuses }) => { seen = statuses; return { jobs: [] }; },
  });
  await handler(req('http://app/api/jobs?status=active'));
  assert.deepEqual(seen, ['queued', 'running']);
});

test('unauthenticated list is 401', async () => {
  const handler = createJobsListHandler({
    getSession: async () => null, getWorkspace: okWorkspace, listJobs: async () => ({ jobs: [] }), pool: {},
  });
  assert.equal((await handler(req('http://app/api/jobs'))).status, 401);
});

test('get returns 404 for a job not in this workspace', async () => {
  const handler = createJobGetHandler({
    getSession: okSession, getWorkspace: okWorkspace, pool: {},
    getJob: async () => null,
  });
  const res = await handler(req('http://app/api/jobs/j9'), { params: Promise.resolve({ id: 'j9' }) });
  assert.equal(res.status, 404);
});
