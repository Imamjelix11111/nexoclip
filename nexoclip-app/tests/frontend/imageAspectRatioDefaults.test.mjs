import test from 'node:test';
import assert from 'node:assert/strict';
import { getAspectRatiosForModel, getAspectRatiosForI2IModel } from '../../packages/studio/src/models.js';

test('image studio ratio lists exclude Auto and default to portrait', () => {
  for (const ratios of [
    getAspectRatiosForModel('nano-banana-pro'),
    getAspectRatiosForI2IModel('nano-banana-pro-edit'),
  ]) {
    assert.equal(ratios.includes('Auto'), false);
    assert.equal(ratios[0], '9:16');
  }
});
