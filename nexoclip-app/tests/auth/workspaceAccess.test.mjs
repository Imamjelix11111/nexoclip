import test from 'node:test';
import assert from 'node:assert/strict';
import { listUserWorkspaces } from '../../src/repositories/workspaceRepository.js';

test('lists only workspaces for the authenticated user', async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [{ id: 'workspace-1', role: 'owner' }] };
    },
  };

  const rows = await listUserWorkspaces(client, 'user-1');

  assert.deepEqual(rows, [{ id: 'workspace-1', role: 'owner' }]);
  assert.deepEqual(calls[0].values, ['user-1']);
  assert.match(calls[0].text, /wm\.user_id = \$1/);
});
