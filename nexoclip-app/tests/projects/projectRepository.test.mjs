import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject,
  listProjects,
  findProject,
} from '../../src/repositories/projectRepository.js';

function clientFor(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      return { rows };
    },
  };
}

test('lists projects by workspace, never globally', async () => {
  const client = clientFor([{ id: 'p1', workspace_id: 'w1' }]);
  const result = await listProjects(client, 'w1');
  assert.deepEqual(result, [{ id: 'p1', workspace_id: 'w1' }]);
  assert.deepEqual(client.calls[0].values, ['w1']);
  assert.match(client.calls[0].text, /WHERE workspace_id = \$1/);
});

test('creates a project with its workspace id', async () => {
  const client = clientFor([{ id: 'p1', workspace_id: 'w1', slug: 'demo' }]);
  const result = await createProject(client, {
    workspaceId: 'w1', name: 'Demo', slug: 'demo', description: null,
  });
  assert.equal(result.id, 'p1');
  assert.deepEqual(client.calls[0].values, ['w1', 'Demo', 'demo', null]);
});

test('finds a project only inside the requested workspace', async () => {
  const client = clientFor([]);
  assert.equal(await findProject(client, 'w2', 'p1'), null);
  assert.deepEqual(client.calls[0].values, ['w2', 'p1']);
  assert.match(client.calls[0].text, /workspace_id = \$1 AND id = \$2/);
});
