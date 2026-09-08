process.env.DATABASE_URL ||= 'postgres://test:test@localhost/test';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationEstimateHandler } from '../../app/api/generations/estimate/route.js';

function request(body, workspaceId = 'w1') {
  const req = new Request('http://app/api/generations/estimate', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-id': workspaceId }, body: JSON.stringify(body),
  });
  req.cookies = { get: () => ({ value: 'token' }) };
  return req;
}

test('estimate route authorizes workspace and uses server pricing', async () => {
  let args;
  const handler = createGenerationEstimateHandler({
    resolveContext: async () => ({ user: { id: 'u1' }, workspace: { id: 'w1', role: 'member' } }),
    estimate: async (_pool, input) => { args = input; return { amount: '8.000000', operation: input.operation, quantity: input.quantity }; },
    pool: {},
  });
  const response = await handler(request({ operation: 'image_generation', quantity: 1 }));
  assert.equal(response.status, 200);
  assert.deepEqual(args, { operation: 'image_generation', quantity: 1, pricingVersion: null });
});

test('estimate route rejects invalid operation and quantity before pricing', async () => {
  let called = false;
  const handler = createGenerationEstimateHandler({
    resolveContext: async () => ({ user: { id: 'u1' }, workspace: { id: 'w1' } }),
    estimate: async () => { called = true; }, pool: {},
  });
  assert.equal((await handler(request({ operation: '', quantity: 1 }))).status, 400);
  assert.equal((await handler(request({ operation: 'image_generation', quantity: 0 }))).status, 400);
  assert.equal(called, false);
});
