import test from 'node:test';
import assert from 'node:assert/strict';
import { findPricingRule } from '../../src/repositories/pricingRepository.js';

test('finds the latest effective active rule unless a version is requested', async () => {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [{ pricing_version_id: 'pv-2', pricing_version: 2, operation: 'image.generate', unit: 'image', unit_price: '1.25' }] };
    },
  };

  const latest = await findPricingRule(pool, { operation: 'image.generate' });
  assert.deepEqual(latest, {
    pricingVersion: { id: 'pv-2', version: 2 },
    rule: { operation: 'image.generate', unit: 'image', unitPrice: '1.25' },
  });
  assert.match(calls[0].text, /pv\.status = 'active'/);

  await findPricingRule(pool, { operation: 'image.generate', pricingVersion: 'pv-1' });
  assert.equal(calls[1].values[1], 'pv-1');
  assert.match(calls[1].text, /pv\.id = \$2/);
});
