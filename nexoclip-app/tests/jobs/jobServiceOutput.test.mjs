import test from 'node:test';
import assert from 'node:assert/strict';
import { listJobs } from '../../src/services/jobService.js';

test('lists a generated asset as an authenticated job output URL', async () => {
  const pool = {
    query: async () => ({ rows: [{
      id: 'job-1', workspace_id: 'workspace-1', kind: 'image', status: 'succeeded',
      parameters: {}, result: {}, error: null, output_asset_id: 'asset-1',
      created_at: '2026-09-08T00:00:00.000Z', updated_at: '2026-09-08T00:00:00.000Z',
    }] }),
  };

  const { jobs } = await listJobs({ pool, workspaceId: 'workspace-1', kind: 'image' });

  assert.equal(jobs[0].result.outputUrl, '/api/assets/asset-1/download?workspace_id=workspace-1');
  assert.equal(jobs[0].result.thumbnailUrl, '/api/assets/asset-1/download?workspace_id=workspace-1');
});
