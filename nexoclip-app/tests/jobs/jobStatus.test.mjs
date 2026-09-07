import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientPollFailure } from '../../src/lib/jobs/jobStatus.js';

test('keeps remote jobs running on transient polling failures', () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isTransientPollFailure(status), true, String(status));
  }
});

test('allows definitive client/provider failures to become failed jobs', () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isTransientPollFailure(status), false, String(status));
  }
});
