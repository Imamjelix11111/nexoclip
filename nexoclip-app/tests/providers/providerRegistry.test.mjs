import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDirectProvider,
  isRetryableProviderError,
  createDirectProviderUnavailableError,
} from '../../src/providers/providerRegistry.js';

test('maps supported generator model IDs to direct providers', () => {
  assert.deepEqual(getDirectProvider('google-imagen4'), { provider: 'google', model: 'imagen-4.0-generate-001' });
  assert.deepEqual(getDirectProvider('google-imagen4-fast'), { provider: 'google', model: 'imagen-4.0-fast-generate-001' });
  assert.deepEqual(getDirectProvider('gpt-image-1.5'), { provider: 'openai', model: 'gpt-image-1.5' });
  assert.deepEqual(getDirectProvider('seedance-v2.0-t2v'), { provider: 'byteplus', model: 'dreamina-seedance-2-0-260128' });
  assert.deepEqual(getDirectProvider('gemini-2.5-flash-image'), { provider: 'google', model: 'gemini-2.5-flash-image' });
  assert.equal(getDirectProvider('flux-2-pro'), null);
});

test('only classifies transient failures as retryable', () => {
  for (const status of [408, 409, 429, 500, 502, 503, 504]) assert.equal(isRetryableProviderError({ status }), true);
  assert.equal(isRetryableProviderError({ status: 401 }), false);
  assert.equal(isRetryableProviderError({ status: 400 }), false);
  assert.equal(isRetryableProviderError(new TypeError('fetch failed')), true);
});

test('creates safe unsupported direct provider error', () => {
  const error = createDirectProviderUnavailableError('unknown/model', null);
  assert.equal(error.code, 'DIRECT_PROVIDER_UNAVAILABLE');
  assert.equal(error.status, 503);
  assert.equal(error.model, 'unknown/model');
  assert.match(error.message, /fallback direct provider/i);
});
