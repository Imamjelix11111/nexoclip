import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BytePlusAssetsError,
  createBytePlusAssetsClient,
  mapBytePlusAssetStatus,
} from '../../src/providers/byteplusAssetsClient.js';

const env = {
  BYTEPLUS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  BYTEPLUS_SECRET_ACCESS_KEY: 'secret-key-value',
  BYTEPLUS_PROJECT_NAME: 'project-x',
};
const fixedNow = () => new Date('2026-09-16T12:34:56.000Z');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function recordingClient(result = { Result: { Id: 'result-1' } }) {
  const calls = [];
  const client = createBytePlusAssetsClient({
    env,
    now: fixedNow,
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(result);
    },
  });
  return { client, calls };
}

test('requires both Assets API credentials without exposing the configured credential', () => {
  assert.throws(
    () => createBytePlusAssetsClient({ env: { BYTEPLUS_ACCESS_KEY_ID: 'do-not-leak' } }),
    (error) => {
      assert.ok(error instanceof BytePlusAssetsError);
      assert.equal(error.code, 'BYTEPLUS_ASSETS_NOT_CONFIGURED');
      assert.equal(error.status, 503);
      assert.equal(error.message, 'BytePlus Assets API is not configured.');
      assert.doesNotMatch(JSON.stringify(error), /do-not-leak/);
      return true;
    },
  );
});

test('exposes only the three focused Assets API operations', () => {
  const { client } = recordingClient();
  assert.deepEqual(Object.keys(client).sort(), ['createAsset', 'createAssetGroup', 'getAsset']);
});

test('signs CreateAssetGroup and sends the exact AIGC group body', async () => {
  const { client, calls } = recordingClient({ Result: { Id: 'group-1' } });

  const result = await client.createAssetGroup({ name: 'Portrait', description: 'Canvas asset' });

  assert.deepEqual(result, { Id: 'group-1' });
  assert.equal(calls[0].url, 'https://ark.ap-southeast-1.byteplusapi.com/?Action=CreateAssetGroup&Version=2024-01-01');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, '{"Name":"Portrait","Description":"Canvas asset","GroupType":"AIGC","ProjectName":"project-x"}');
  assert.deepEqual(calls[0].options.headers, {
    'Content-Type': 'application/json',
    Host: 'ark.ap-southeast-1.byteplusapi.com',
    'X-Content-Sha256': '61321a6646a575918d2c8568a4ab6048b40ce4cedc018ca2c54db41e3c760737',
    'X-Date': '20260916T123456Z',
    Authorization: 'HMAC-SHA256 Credential=AKIDEXAMPLE/20260916/ap-southeast-1/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=220b1a7f851412f8fd3c593600ff7e8a8d309f21a0b160c4ed6525889ecccf41',
  });
});

test('signs CreateAsset and enforces image and moderation body semantics', async () => {
  const { client, calls } = recordingClient({ Result: { Id: 'asset-1' } });

  const result = await client.createAsset({
    groupId: 'group-1',
    url: 'https://objects.example/source.png?token=short',
    name: 'Character',
  });

  assert.deepEqual(result, { Id: 'asset-1' });
  assert.equal(calls[0].url, 'https://ark.ap-southeast-1.byteplusapi.com/?Action=CreateAsset&Version=2024-01-01');
  assert.equal(calls[0].options.body, '{"GroupId":"group-1","URL":"https://objects.example/source.png?token=short","Name":"Character","AssetType":"Image","Moderation":{"Strategy":"Skip"},"ProjectName":"project-x"}');
  assert.equal(calls[0].options.headers.Authorization, 'HMAC-SHA256 Credential=AKIDEXAMPLE/20260916/ap-southeast-1/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=3a637af99eaeab6f44fc2efa51bb11e20b8968c652cde85a0aa22849a00b8401');
});

test('signs GetAsset and sends only the asset and project identifiers', async () => {
  const payload = { Result: { Id: 'asset-1', Status: 'Processing' } };
  const { client, calls } = recordingClient(payload);

  const result = await client.getAsset({ assetId: 'asset-1' });

  assert.deepEqual(result, payload.Result);
  assert.equal(calls[0].url, 'https://ark.ap-southeast-1.byteplusapi.com/?Action=GetAsset&Version=2024-01-01');
  assert.equal(calls[0].options.body, '{"Id":"asset-1","ProjectName":"project-x"}');
  assert.equal(calls[0].options.headers.Authorization, 'HMAC-SHA256 Credential=AKIDEXAMPLE/20260916/ap-southeast-1/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=306556bb6bbd5c0637327f62167dbe6d5fd16cce65a380c85a7e256d9f330ebd');
});

test('uses the documented default project and configured region', async () => {
  const calls = [];
  const client = createBytePlusAssetsClient({
    env: {
      BYTEPLUS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      BYTEPLUS_SECRET_ACCESS_KEY: 'secret-key-value',
      BYTEPLUS_REGION: 'eu-central-1',
    },
    now: fixedNow,
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ Result: { Id: 'group-1' } });
    },
  });

  await client.createAssetGroup({ name: 'Portrait' });

  assert.match(calls[0].url, /^https:\/\/ark\.eu-central-1\.byteplusapi\.com\//);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    Name: 'Portrait',
    GroupType: 'AIGC',
    ProjectName: 'default',
  });
  assert.match(calls[0].options.headers.Authorization, /\/eu-central-1\/ark\/request/);
});

test('maps Active, Failed, and every pending status to safe local states', () => {
  assert.deepEqual(mapBytePlusAssetStatus({ Result: { Status: 'Active' } }), { status: 'active' });
  assert.deepEqual(
    mapBytePlusAssetStatus({ Result: { Status: 'Failed', Error: { Code: 'SensitiveCode', Message: 'internal provider detail' } } }),
    { status: 'failed', error: { code: 'BYTEPLUS_ASSET_PROCESSING_FAILED', message: 'BytePlus could not process this asset.' } },
  );
  for (const status of ['Processing', 'Queued', 'Pending', undefined]) {
    assert.deepEqual(mapBytePlusAssetStatus({ Result: { Status: status } }), { status: 'processing' });
  }
});

test('returns retryable typed errors for transport and transient HTTP failures', async () => {
  const transportClient = createBytePlusAssetsClient({
    env,
    now: fixedNow,
    fetchFn: async () => { throw new TypeError('fetch failed with secret-key-value'); },
  });
  const transientClient = createBytePlusAssetsClient({
    env,
    now: fixedNow,
    fetchFn: async () => jsonResponse({ ResponseMetadata: { Error: { Message: 'AKIDEXAMPLE secret-key-value' } } }, 429),
  });

  for (const [promise, status] of [
    [transportClient.getAsset({ assetId: 'asset-1' }), 503],
    [transientClient.getAsset({ assetId: 'asset-1' }), 429],
  ]) {
    await assert.rejects(promise, (error) => {
      assert.ok(error instanceof BytePlusAssetsError);
      assert.equal(error.code, 'BYTEPLUS_ASSETS_UNAVAILABLE');
      assert.equal(error.status, status);
      assert.equal(error.retryable, true);
      assert.equal(error.message, 'BytePlus Assets API is temporarily unavailable.');
      assert.doesNotMatch(JSON.stringify(error), /AKIDEXAMPLE|secret-key-value/);
      return true;
    });
  }
});

test('turns malformed success payloads into safe typed errors', async () => {
  const client = createBytePlusAssetsClient({
    env,
    now: fixedNow,
    fetchFn: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('secret-key-value'); } }),
  });

  await assert.rejects(client.getAsset({ assetId: 'asset-1' }), (error) => {
    assert.ok(error instanceof BytePlusAssetsError);
    assert.equal(error.code, 'BYTEPLUS_ASSETS_INVALID_RESPONSE');
    assert.equal(error.status, 502);
    assert.equal(error.message, 'BytePlus Assets API returned an invalid response.');
    assert.doesNotMatch(JSON.stringify(error), /secret-key-value/);
    return true;
  });
});

test('turns non-transient provider failures into credential-free typed errors', async () => {
  const responses = [
    jsonResponse({ ResponseMetadata: { Error: { Message: 'AKIDEXAMPLE secret-key-value' } } }, 400),
    jsonResponse({ ResponseMetadata: { Error: { Code: 'InvalidParameter', Message: 'AKIDEXAMPLE secret-key-value' } } }),
  ];

  for (const response of responses) {
    const client = createBytePlusAssetsClient({ env, now: fixedNow, fetchFn: async () => response });
    await assert.rejects(client.createAssetGroup({ name: 'Portrait' }), (error) => {
      assert.ok(error instanceof BytePlusAssetsError);
      assert.equal(error.code, 'BYTEPLUS_ASSETS_REQUEST_FAILED');
      assert.equal(error.status, 400);
      assert.equal(error.retryable, false);
      assert.equal(error.message, 'BytePlus Assets API request failed.');
      assert.doesNotMatch(JSON.stringify(error), /AKIDEXAMPLE|secret-key-value/);
      return true;
    });
  }
});
