import test from 'node:test';
import assert from 'node:assert/strict';
import { createMuapiAdapter } from '../../src/providers/muapi/adapter.js';

function response(body, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async json() { return body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

test('submits a generation with the injected MuAPI credential and returns its provider id', async () => {
  const calls = [];
  const adapter = createMuapiAdapter({
    baseUrl: 'https://muapi.test/',
    apiKey: 'server-secret',
    fetch: async (...args) => {
      calls.push(args);
      return response({ request_id: 'req-123', status: 'queued' });
    },
  });

  const result = await adapter.submitGeneration({ model: 'flux-dev', payload: { prompt: 'a cat' } });

  assert.deepEqual(result, { providerRequestId: 'req-123', status: 'queued' });
  assert.equal(calls[0][0], 'https://muapi.test/api/v1/flux-dev');
  assert.equal(calls[0][1].headers['x-api-key'], 'server-secret');
  assert.deepEqual(JSON.parse(calls[0][1].body), { prompt: 'a cat' });
});

test('gets status and cancels through provider prediction endpoints', async () => {
  const calls = [];
  const adapter = createMuapiAdapter({
    baseUrl: 'https://muapi.test',
    apiKey: 'server-secret',
    fetch: async (...args) => {
      calls.push(args);
      return response({ request_id: 'req-123', status: 'processing' });
    },
  });

  await adapter.getGenerationStatus('req-123');
  await adapter.cancelGeneration('req-123');

  assert.equal(calls[0][0], 'https://muapi.test/api/v1/predictions/req-123/result');
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[1][0], 'https://muapi.test/api/v1/predictions/req-123');
  assert.equal(calls[1][1].method, 'DELETE');
});

test('normalizes completed results without exposing provider response details', () => {
  const adapter = createMuapiAdapter({ baseUrl: 'https://muapi.test', apiKey: 'server-secret', fetch: async () => response({}) });

  assert.deepEqual(adapter.normalizeResult({
    request_id: 'req-123',
    status: 'succeeded',
    outputs: ['https://cdn.test/image.png'],
    cost: 12,
    api_key: 'must-not-escape',
  }), {
    providerRequestId: 'req-123',
    status: 'succeeded',
    outputs: ['https://cdn.test/image.png'],
    usage: { cost: 12 },
  });
});

test('normalizes provider and transport errors without leaking credentials or response bodies', async () => {
  const adapter = createMuapiAdapter({
    baseUrl: 'https://muapi.test',
    apiKey: 'server-secret',
    fetch: async () => response({ detail: 'secret server response', api_key: 'server-secret' }, { status: 401, statusText: 'Unauthorized' }),
  });

  await assert.rejects(
    adapter.submitGeneration({ model: 'flux-dev', payload: {} }),
    (error) => {
      assert.deepEqual(error, { code: 'PROVIDER_AUTHENTICATION_FAILED', status: 401, message: 'MuAPI authentication failed' });
      assert.equal(JSON.stringify(error).includes('server-secret'), false);
      return true;
    },
  );
});
