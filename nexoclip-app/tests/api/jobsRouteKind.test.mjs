process.env.DATABASE_URL ||= 'postgres://test:test@localhost/test';

import test from 'node:test';
import assert from 'node:assert/strict';

const { createJobsListHandler } = await import('../../app/api/jobs/route.js');

function req(url) {
  const r = new Request(url, { method: 'GET' });
  r.cookies = { get: (n) => (n === 'nexoclip_session' ? { value: 'tok' } : undefined) };
  return r;
}

test('forwards ?kind to the service', async () => {
  let seen;
  const handler = createJobsListHandler({
    getSession: async () => ({ user_id: 'u1' }), getWorkspace: async () => ({ id: 'ws-1' }), pool: {},
    listJobs: async ({ kind }) => { seen = kind; return { jobs: [] }; },
  });
  await handler(req('http://app/api/jobs?kind=image'));
  assert.equal(seen, 'image');
});
