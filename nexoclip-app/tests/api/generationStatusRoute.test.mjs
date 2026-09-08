import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationStatusHandler } from '../../app/api/generations/[generationId]/route.js';

test('awaits dynamic route params before reading the generation id', async () => {
  let requestedId;
  const handler = createGenerationStatusHandler({
    resolveContext: async () => ({ workspace: { id: 'w1' } }),
    getGeneration: async (_workspaceId, generationId) => { requestedId = generationId; return { id: generationId }; },
    createStorage: () => ({}),
  });
  const request = new Request('http://app/api/generations/g1', { headers: { 'x-workspace-id': 'w1' } });
  request.cookies = { get: () => ({ value: 'session' }) };
  const response = await handler(request, { params: Promise.resolve({ generationId: 'g1' }) });
  assert.equal(response.status, 200);
  assert.equal(requestedId, 'g1');
});
