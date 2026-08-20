import test from 'node:test';
import assert from 'node:assert/strict';
import { listJobs } from '../../src/services/jobService.js';

function fakePool(rows) {
  return {
    async query(text, paramsArr) {
      // Assert the kind predicate is present and bound when a kind is passed.
      if (/kind = ANY|kind = \$/i.test(text)) {
        const kind = paramsArr.find((p) => p === 'image');
        return { rows: rows.filter((r) => r.kind === kind) };
      }
      return { rows };
    },
  };
}

test('listJobs filters by kind when provided', async () => {
  const rows = [
    { id: 'a', workspace_id: 'ws', kind: 'image', status: 'succeeded', parameters: {}, result: null, error: null, created_at: 't', updated_at: 't' },
    { id: 'b', workspace_id: 'ws', kind: 'video', status: 'running', parameters: {}, result: null, error: null, created_at: 't', updated_at: 't' },
  ];
  const { jobs } = await listJobs({ pool: fakePool(rows), workspaceId: 'ws', kind: 'image' });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, 'image');
});
