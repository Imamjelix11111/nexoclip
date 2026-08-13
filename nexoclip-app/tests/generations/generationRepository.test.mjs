import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageGeneration, findGeneration } from '../../src/repositories/generationRepository.js';

function clientFor(rows = []) {
  const calls = [];
  return { calls, async query(text, values) { calls.push({ text, values }); return { rows }; } };
}

test('creates a queued image generation scoped to a workspace', async () => {
  const client = clientFor([{ id: 'g1', workspace_id: 'w1', status: 'queued' }]);
  const generation = await createImageGeneration(client, {
    workspaceId: 'w1', projectId: 'p1', prompt: 'fox', model: 'flux-dev', parameters: { aspectRatio: '1:1' },
  });
  assert.equal(generation.status, 'queued');
  assert.deepEqual(client.calls[0].values, ['w1', 'p1', 'fox', 'flux-dev', '{"aspectRatio":"1:1"}']);
  assert.match(client.calls[0].text, /INSERT INTO generation_jobs/);
});

test('finds a generation only within the requested workspace', async () => {
  const client = clientFor([]);
  assert.equal(await findGeneration(client, 'w2', 'g1'), null);
  assert.deepEqual(client.calls[0].values, ['w2', 'g1']);
  assert.match(client.calls[0].text, /WHERE workspace_id = \$1 AND id = \$2/);
});
