import test from 'node:test';
import assert from 'node:assert/strict';
import { createInternalGenerationHandler } from '../../app/api/internal/generations/route.js';

const userId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';

test('publishes a successfully reserved internal image generation', async () => {
  const published = [];
  const handler = createInternalGenerationHandler({
    verify: () => true,
    getDefaultWorkspace: async () => ({ id: 'workspace-1' }),
    getPool: () => ({ id: 'pool' }),
    reserve: async () => ({ id: 'generation-1', kind: 'image' }),
    publish: async (input) => published.push(input),
  });
  const response = await handler(new Request('http://app/api/internal/generations', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'submit', userId, projectId, nodeId: 'node-1', timestamp: 1, nonce: 'nonce', signature: 'signature',
      input: { kind: 'image', prompt: 'fox', model: 'model-1', idempotencyKey: 'key-1' },
    }),
  }));

  assert.equal(response.status, 201);
  assert.deepEqual(published, [{ pool: { id: 'pool' }, kind: 'image' }]);
});
