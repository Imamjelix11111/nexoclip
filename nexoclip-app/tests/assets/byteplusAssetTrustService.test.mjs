import test from 'node:test';
import assert from 'node:assert/strict';
import { BytePlusAssetsError } from '../../src/providers/byteplusAssetsClient.js';
import { listWorkspaceAssets } from '../../src/services/assetService.js';
import { createBytePlusAssetTrustService } from '../../src/services/byteplusAssetTrustService.js';

function fixture({ asset, link } = {}) {
  let current = link ? { ...link } : null;
  const calls = { queries: [], downloads: [], groups: [], assets: [], gets: [], resets: 0 };
  const client = {
    async query(text, values) {
      calls.queries.push({ text, values });
      if (text.includes('FROM assets')) return { rows: asset ? [{ ...asset }] : [] };
      return { rows: [] };
    },
    release() {},
  };
  const repository = {
    async findBytePlusAssetLink(_client, workspaceId, assetId) {
      return current?.workspace_id === workspaceId && current?.local_asset_id === assetId ? { ...current } : null;
    },
    async createProcessingBytePlusAssetLink(_client, input) {
      current ||= {
        workspace_id: input.workspaceId,
        local_asset_id: input.localAssetId,
        project_name: input.projectName,
        status: 'processing',
        group_id: null,
        provider_asset_id: null,
        error: null,
      };
      return { ...current };
    },
    async updateBytePlusAssetLink(_client, input) {
      current = {
        ...current,
        group_id: input.groupId ?? current.group_id,
        provider_asset_id: input.providerAssetId ?? current.provider_asset_id,
        status: input.status,
        error: input.error ?? null,
      };
      return { ...current };
    },
    async resetBytePlusAssetLink() {
      calls.resets += 1;
      current = { ...current, group_id: null, provider_asset_id: null, status: 'processing', error: null };
      return { ...current };
    },
  };
  const provider = {
    async createAssetGroup(input) { calls.groups.push(input); return { Id: 'group-secret' }; },
    async createAsset(input) { calls.assets.push(input); return { Id: 'provider-asset-secret' }; },
    async getAsset(input) { calls.gets.push(input); return { Status: 'Processing' }; },
  };
  const service = createBytePlusAssetTrustService({
    pool: { async connect() { return client; } },
    storage: {
      async createDownloadUrl(input) {
        calls.downloads.push(input);
        return { url: 'https://objects.example/source.png?signature=secret' };
      },
    },
    assetsClientFactory: () => provider,
    repository,
    env: { BYTEPLUS_PROJECT_NAME: 'project-x' },
  });
  return { service, provider, calls, getLink: () => current };
}

const image = {
  id: 'asset-1', workspace_id: 'workspace-1', storage_key: 'workspace-1/asset-1',
  filename: 'portrait.png', content_type: 'image/png',
};

test('starts image trust in the workspace with a short-lived source URL and safe result', async () => {
  const { service, calls, getLink } = fixture({ asset: image });

  assert.deepEqual(await service.startTrust('workspace-1', 'asset-1'), { status: 'processing' });
  assert.deepEqual(calls.downloads, [{ key: 'workspace-1/asset-1', expiresInSeconds: 300 }]);
  assert.deepEqual(calls.groups, [{ name: 'portrait.png', description: 'NexoClip workspace asset' }]);
  assert.deepEqual(calls.assets, [{
    groupId: 'group-secret', url: 'https://objects.example/source.png?signature=secret', name: 'portrait.png',
  }]);
  assert.deepEqual(calls.queries.find(({ text }) => text.includes('FROM assets')).values, ['workspace-1', 'asset-1']);
  assert.match(calls.queries.find(({ text }) => text.includes('FROM assets')).text, /FOR UPDATE/);
  assert.equal(getLink().provider_asset_id, 'provider-asset-secret');
  assert.doesNotMatch(JSON.stringify(await service.getTrust('workspace-1', 'asset-1')), /secret|signature|group/i);
});

test('rejects non-images and cannot see assets from another workspace', async () => {
  const video = fixture({ asset: { ...image, content_type: 'video/mp4' } });
  await assert.rejects(
    video.service.startTrust('workspace-1', 'asset-1'),
    (error) => error.code === 'BYTEPLUS_ASSET_TYPE_UNSUPPORTED' && error.status === 400,
  );
  assert.equal(video.calls.groups.length, 0);
  assert.equal(video.calls.downloads.length, 0);

  const outsideWorkspace = fixture();
  assert.equal(await outsideWorkspace.service.startTrust('workspace-1', 'asset-2'), null);
  assert.equal(outsideWorkspace.getLink(), null);
});

test('POST is idempotent for usable processing and active links', async () => {
  for (const link of [
    { workspace_id: 'workspace-1', local_asset_id: 'asset-1', status: 'processing', provider_asset_id: 'provider-1' },
    { workspace_id: 'workspace-1', local_asset_id: 'asset-1', status: 'active', provider_asset_id: 'provider-1' },
  ]) {
    const { service, calls } = fixture({ asset: image, link });
    assert.deepEqual(await service.startTrust('workspace-1', 'asset-1'), { status: link.status });
    assert.equal(calls.groups.length, 0);
    assert.equal(calls.assets.length, 0);
    assert.equal(calls.downloads.length, 0);
  }
});

test('POST retries failed and corrupt active links', async () => {
  for (const link of [
    {
      workspace_id: 'workspace-1', local_asset_id: 'asset-1', status: 'failed',
      group_id: 'old-group', provider_asset_id: 'old-asset', error: { raw: 'do not expose' },
    },
    {
      workspace_id: 'workspace-1', local_asset_id: 'asset-1', status: 'active',
      group_id: 'corrupt-group', provider_asset_id: null,
    },
  ]) {
    const retry = fixture({ asset: image, link });
    assert.deepEqual(await retry.service.startTrust('workspace-1', 'asset-1'), { status: 'processing' });
    assert.equal(retry.calls.resets, 1);
    assert.equal(retry.calls.groups.length, 1);
  }
});

test('POST resumes incomplete processing links without duplicating an existing group', async () => {
  const incomplete = fixture({ asset: image, link: {
    workspace_id: 'workspace-1', local_asset_id: 'asset-1', status: 'processing',
    group_id: 'existing-group', provider_asset_id: null,
  } });
  assert.deepEqual(await incomplete.service.startTrust('workspace-1', 'asset-1'), { status: 'processing' });
  assert.equal(incomplete.calls.groups.length, 0);
  assert.equal(incomplete.calls.assets[0].groupId, 'existing-group');
});

test('missing BytePlus configuration fails before changing trust state', async () => {
  const { calls, getLink } = fixture({ asset: image });
  const unconfigured = createBytePlusAssetTrustService({
    pool: { async connect() { throw new Error('database must not be touched'); } },
    storage: { async createDownloadUrl() { throw new Error('storage must not be touched'); } },
    env: {},
  });

  await assert.rejects(
    unconfigured.startTrust('workspace-1', 'asset-1'),
    (error) => error instanceof BytePlusAssetsError && error.code === 'BYTEPLUS_ASSETS_NOT_CONFIGURED',
  );
  assert.equal(calls.groups.length, 0);
  assert.equal(getLink(), null);
});

test('GET refreshes processing links to active or a canonical failed state', async () => {
  const active = fixture({ asset: image, link: {
    workspace_id: 'workspace-1', local_asset_id: 'asset-1', status: 'processing', provider_asset_id: 'provider-1',
  } });
  active.provider.getAsset = async () => ({ Status: 'Active', ProviderDetail: 'do not expose' });
  assert.deepEqual(await active.service.getTrust('workspace-1', 'asset-1'), { status: 'active' });

  const failed = fixture({ asset: image, link: {
    workspace_id: 'workspace-1', local_asset_id: 'asset-1', status: 'processing', provider_asset_id: 'provider-1',
  } });
  failed.provider.getAsset = async () => ({ Status: 'Failed', Error: { Message: 'raw provider failure' } });
  assert.deepEqual(await failed.service.getTrust('workspace-1', 'asset-1'), {
    status: 'failed',
    error: { code: 'BYTEPLUS_ASSET_PROCESSING_FAILED', message: 'BytePlus could not process this asset.' },
  });
  assert.doesNotMatch(JSON.stringify(failed.getLink().error), /raw provider failure/);
});

test('GET safely retries provider refresh errors and reports missing mappings', async () => {
  const absent = fixture({ asset: image });
  assert.deepEqual(await absent.service.getTrust('workspace-1', 'asset-1'), { status: 'not_trusted' });

  const transient = fixture({ asset: image, link: {
    workspace_id: 'workspace-1', local_asset_id: 'asset-1', status: 'processing', provider_asset_id: 'provider-1',
  } });
  transient.provider.getAsset = async () => { throw new BytePlusAssetsError('BytePlus Assets API is temporarily unavailable.', {
    code: 'BYTEPLUS_ASSETS_UNAVAILABLE', status: 503, retryable: true,
  }); };
  await assert.rejects(transient.service.getTrust('workspace-1', 'asset-1'), { code: 'BYTEPLUS_ASSETS_UNAVAILABLE' });
  assert.equal(transient.getLink().status, 'processing');
});

test('workspace listing adds only safe trust state and preserves ordinary asset fields', async () => {
  const rows = [{
    ...image,
    size_bytes: 42,
    created_at: '2026-09-16T00:00:00.000Z',
    byteplus_trust_status: 'failed',
    byteplus_trust_error: { Message: 'raw provider error', provider_asset_id: 'provider-secret' },
    byteplus_has_provider_asset: true,
  }];
  let sql;
  const assets = await listWorkspaceAssets('workspace-1', {
    async query(text, values) { sql = text; assert.deepEqual(values, ['workspace-1']); return { rows }; },
  });

  assert.deepEqual(assets, [{
    id: 'asset-1', workspace_id: 'workspace-1', storage_key: 'workspace-1/asset-1', filename: 'portrait.png',
    content_type: 'image/png', size_bytes: 42, created_at: '2026-09-16T00:00:00.000Z',
    url: '/api/assets/asset-1/download?workspace_id=workspace-1',
    byteplus_trust: {
      status: 'failed',
      error: { code: 'BYTEPLUS_ASSET_PROCESSING_FAILED', message: 'BytePlus could not process this asset.' },
    },
  }]);
  assert.match(sql, /LEFT JOIN byteplus_asset_links/);
  assert.doesNotMatch(sql, /SELECT[\s\S]*bal\.(group_id|provider_asset_id)(?!\s+IS NOT NULL)/i);
  assert.doesNotMatch(JSON.stringify(assets), /provider-secret|raw provider error/);
});
