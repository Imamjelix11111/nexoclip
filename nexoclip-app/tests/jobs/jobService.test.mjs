import test from 'node:test';
import assert from 'node:assert/strict';
import { createJob, getJob, listJobs, updateJobStatus } from '../../src/services/jobService.js';

// Minimal in-memory fake of a pg pool for the SQL our repo issues.
function fakePool() {
  const rows = [];
  let seq = 0;
  return {
    rows,
    async query(text, paramsArr) {
      if (/INSERT INTO generation_jobs/i.test(text)) {
        const [workspaceId, kind, params] = paramsArr;
        const row = {
          id: `job-${++seq}`, workspace_id: workspaceId, kind, status: 'queued',
          parameters: params, result: null, error: null,
          created_at: 't0', updated_at: 't0',
        };
        rows.push(row);
        return { rows: [row] };
      }
      if (/UPDATE generation_jobs/i.test(text)) {
        const [workspaceId, id, status, result, error] = paramsArr;
        const row = rows.find((r) => r.workspace_id === workspaceId && r.id === id);
        if (!row) return { rows: [] };
        Object.assign(row, { status, result, error, updated_at: 't1' });
        return { rows: [row] };
      }
      if (/WHERE workspace_id = \$1 AND id = \$2/i.test(text)) {
        const [workspaceId, id] = paramsArr;
        return { rows: rows.filter((r) => r.workspace_id === workspaceId && r.id === id) };
      }
      // list
      const [workspaceId] = paramsArr;
      return { rows: rows.filter((r) => r.workspace_id === workspaceId) };
    },
  };
}

test('createJob inserts a queued job scoped to the workspace', async () => {
  const pool = fakePool();
  const job = await createJob({ pool, workspaceId: 'ws-1', kind: 'video', params: { prompt: 'a cat' } });
  assert.equal(job.status, 'queued');
  assert.equal(job.id, 'job-1');
});

test('getJob only returns a job in the same workspace', async () => {
  const pool = fakePool();
  const created = await createJob({ pool, workspaceId: 'ws-1', kind: 'video', params: {} });
  assert.equal((await getJob({ pool, workspaceId: 'ws-1', id: created.id })).id, created.id);
  assert.equal(await getJob({ pool, workspaceId: 'ws-2', id: created.id }), null);
});

test('updateJobStatus writes result and status', async () => {
  const pool = fakePool();
  const created = await createJob({ pool, workspaceId: 'ws-1', kind: 'video', params: {} });
  const done = await updateJobStatus({
    pool, workspaceId: 'ws-1', id: created.id, status: 'succeeded',
    result: { kind: 'video', title: 'Render', outputUrl: 'https://x/y.mp4' },
  });
  assert.equal(done.status, 'succeeded');
  assert.equal(done.result.outputUrl, 'https://x/y.mp4');
});

test('listJobs returns only this workspace jobs', async () => {
  const pool = fakePool();
  await createJob({ pool, workspaceId: 'ws-1', kind: 'video', params: {} });
  await createJob({ pool, workspaceId: 'ws-2', kind: 'image', params: {} });
  const { jobs } = await listJobs({ pool, workspaceId: 'ws-1' });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, 'video');
});
