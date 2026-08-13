import test from 'node:test';
import assert from 'node:assert/strict';
import { persistGenerationResult } from '../../src/services/generationOutputService.js';

function poolFor() {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('generation_outputs')) return { rows: [{ id: 'o1' }] };
      return { rows: [{ id: 'u1' }] };
    },
    release() {},
  };
  return { calls, async connect() { return client; } };
}

test('persists outputs and usage in one transaction with workspace context', async () => {
  const pool = poolFor();
  const result = await persistGenerationResult(pool, {
    workspaceId: 'w1', generationId: 'g1', provider: 'muapi', providerRequestId: 'req1',
    estimatedCost: 0.1, outputs: [{ assetId: 'a1' }], usage: { cost: 0.12, units: { seconds: 4 } },
  });
  assert.deepEqual(result, { outputs: [{ id: 'o1' }], usage: { id: 'u1' } });
  assert.equal(pool.calls.filter(({ text }) => text === 'BEGIN').length, 1);
  assert.equal(pool.calls.filter(({ text }) => text === 'COMMIT').length, 1);
});
