import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageGeneration, createVimaxGeneration, findGeneration } from '../../src/repositories/generationRepository.js';

function clientFor(rows = []) {
  const calls = [];
  return { calls, async query(text, values) { calls.push({ text, values }); return { rows }; } };
}

test('creates a queued image generation scoped to a workspace', async () => {
  const client = clientFor([{ id: 'g1', workspace_id: 'w1', status: 'queued' }]);
  const generation = await createImageGeneration(client, {
    workspaceId: 'w1', createdByUserId: 'u1', projectId: 'p1', prompt: 'fox', model: 'flux-dev', parameters: { aspectRatio: '1:1' },
  });
  assert.equal(generation.status, 'queued');
  assert.deepEqual(client.calls[0].values, ['w1', 'u1', 'p1', 'fox', 'flux-dev', '{"aspectRatio":"1:1"}']);
  assert.match(client.calls[0].text, /INSERT INTO generation_jobs/);
  assert.match(client.calls[0].text, /created_by_user_id/);
});

test('creates a ViMax generation with explicit durable-kind fields', async () => {
  const client = clientFor([{ id: 'g1', workspace_id: 'w1', kind: 'vimax_render_video', status: 'queued' }]);
  const generation = await createVimaxGeneration(client, {
    workspaceId: 'w1', projectId: null, kind: 'vimax_render_video', prompt: 'Render ViMax storyboard video', model: 'vimax',
    parameters: { sessionId: 's1', input: {} }, createdByUserId: 'u1', idempotencyKey: 'request-1', estimatedCost: 0, pricingVersionId: 'pv1',
    reservationLedgerId: 'ledger-1', vimaxSessionId: 's1',
  });
  assert.equal(generation.kind, 'vimax_render_video');
  assert.match(client.calls[0].text, /vimax_session_id/);
  assert.match(client.calls[0].text, /provider/);
  assert.deepEqual(client.calls[0].values, [
    'w1', 'u1', null, 'vimax_render_video', 'Render ViMax storyboard video', 'vimax', '{"sessionId":"s1","input":{}}',
    'request-1', 0, 'pv1', 'ledger-1', 's1', 'vimax',
  ]);
});

test('finds a generation only within the requested workspace', async () => {
  const client = clientFor([]);
  assert.equal(await findGeneration(client, 'w2', 'g1'), null);
  assert.deepEqual(client.calls[0].values, ['w2', 'g1']);
  assert.match(client.calls[0].text, /WHERE workspace_id = \$1 AND id = \$2/);
});
