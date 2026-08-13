import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost } from '../../src/services/pricingService.js';

test('estimates a deterministic provider-neutral cost from a versioned rule', () => {
  const result = estimateCost({
    pricingVersion: { id: 'pv-1', version: 3 },
    rule: { operation: 'image.generate', unit: 'image', unitPrice: '1.250000' },
    quantity: 2,
  });

  assert.deepEqual(result, {
    pricingVersionId: 'pv-1',
    pricingVersion: 3,
    operation: 'image.generate',
    unit: 'image',
    quantity: 2,
    amount: '2.500000',
  });
});

test('rejects invalid or non-positive quantities', () => {
  assert.throws(
    () => estimateCost({ pricingVersion: { id: 'pv-1', version: 1 }, rule: { operation: 'x', unit: 'unit', unitPrice: '1' }, quantity: 0 }),
    /Quantity must be a positive integer/,
  );
  assert.throws(
    () => estimateCost({ pricingVersion: { id: 'pv-1', version: 1 }, rule: { operation: 'x', unit: 'unit', unitPrice: '1' }, quantity: 1.5 }),
    /Quantity must be a positive integer/,
  );
});

test('does not use floating point arithmetic for fractional prices', () => {
  const result = estimateCost({
    pricingVersion: { id: 'pv-1', version: 1 },
    rule: { operation: 'video.generate', unit: 'second', unitPrice: '0.100001' },
    quantity: 3,
  });
  assert.equal(result.amount, '0.300003');
});
