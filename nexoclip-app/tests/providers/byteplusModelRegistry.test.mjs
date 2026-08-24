import test from 'node:test';
import assert from 'node:assert/strict';
import { getDirectProvider } from '../../src/providers/providerRegistry.js';

test('maps official BytePlus image model IDs', () => {
  assert.deepEqual(getDirectProvider('dola-seedream-5-0-pro-260628'), { provider: 'byteplus', model: 'dola-seedream-5-0-pro-260628' });
  assert.deepEqual(getDirectProvider('seedream-5-0-260128'), { provider: 'byteplus', model: 'seedream-5-0-260128' });
  assert.deepEqual(getDirectProvider('seedream-5-0-lite-260128'), { provider: 'byteplus', model: 'seedream-5-0-260128' });
  assert.deepEqual(getDirectProvider('seedream-4-5-251128'), { provider: 'byteplus', model: 'seedream-4-5-251128' });
  assert.deepEqual(getDirectProvider('seedream-4-0-250828'), { provider: 'byteplus', model: 'seedream-4-0-250828' });
  assert.deepEqual(getDirectProvider('seedream-3.0-t2i'), { provider: 'byteplus', model: 'seedream-3.0-t2i' });
});

test('maps official BytePlus video model IDs and UI aliases', () => {
  assert.deepEqual(getDirectProvider('dreamina-seedance-2-5-260628'), { provider: 'byteplus', model: 'dreamina-seedance-2-5-260628' });
  assert.deepEqual(getDirectProvider('dreamina-seedance-2-0-260128'), { provider: 'byteplus', model: 'dreamina-seedance-2-0-260128' });
  assert.deepEqual(getDirectProvider('dreamina-seedance-2-0-fast-260128'), { provider: 'byteplus', model: 'dreamina-seedance-2-0-fast-260128' });
  assert.deepEqual(getDirectProvider('dreamina-seedance-2-0-mini-260615'), { provider: 'byteplus', model: 'dreamina-seedance-2-0-mini-260615' });
  assert.deepEqual(getDirectProvider('seedance-1-5-pro-251215'), { provider: 'byteplus', model: 'seedance-1-5-pro-251215' });
  assert.deepEqual(getDirectProvider('seedance-v2.0-t2v'), { provider: 'byteplus', model: 'dreamina-seedance-2-0-260128' });
  assert.deepEqual(getDirectProvider('bytedance/seedance-2.0'), { provider: 'byteplus', model: 'dreamina-seedance-2-0-260128' });
});

test('maps the UI Seedream OpenRouter alias to official BytePlus image model', () => {
  assert.deepEqual(getDirectProvider('bytedance-seed/seedream-5-0-pro'), { provider: 'byteplus', model: 'dola-seedream-5-0-pro-260628' });
});

test('maps 3D IDs to no media fallback', () => {
  assert.equal(getDirectProvider('Hyper3D-Gen2'), null);
  assert.equal(getDirectProvider('Hitem3D-2.0'), null);
});
