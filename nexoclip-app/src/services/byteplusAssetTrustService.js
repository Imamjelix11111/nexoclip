import { getPool } from '../db/pool.js';
import {
  createProcessingBytePlusAssetLink,
  findBytePlusAssetLink,
  resetBytePlusAssetLink,
  updateBytePlusAssetLink,
} from '../repositories/byteplusAssetRepository.js';
import {
  BytePlusAssetsError,
  createBytePlusAssetsClient,
  mapBytePlusAssetStatus,
} from '../providers/byteplusAssetsClient.js';
import { createStorage } from './assetService.js';

const SOURCE_URL_TTL_SECONDS = 300;
const PROCESSING_FAILURE = {
  code: 'BYTEPLUS_ASSET_PROCESSING_FAILED',
  message: 'BytePlus could not process this asset.',
};
const INVALID_STATE_FAILURE = {
  code: 'BYTEPLUS_ASSET_INVALID_STATE',
  message: 'Trusted asset is unavailable. Retry trust.',
};

export class BytePlusAssetTrustError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'BytePlusAssetTrustError';
    this.code = code;
    this.status = status;
  }
}

export function projectBytePlusTrustState(link) {
  const status = link?.status || link?.byteplus_trust_status;
  if (!status) return { status: 'not_trusted' };
  if (status === 'active' && (link.provider_asset_id === null || link.byteplus_has_provider_asset === false)) {
    return { status: 'failed', error: INVALID_STATE_FAILURE };
  }
  if (status === 'failed') return { status: 'failed', error: PROCESSING_FAILURE };
  return { status };
}

function invalidProviderResult() {
  return new BytePlusAssetTrustError('Unable to update trusted asset.', {
    code: 'BYTEPLUS_ASSET_TRUST_FAILED',
    status: 502,
  });
}

function requireProviderId(result) {
  if (typeof result?.Id !== 'string' || !result.Id.trim()) throw invalidProviderResult();
  return result.Id;
}

const defaultRepository = {
  createProcessingBytePlusAssetLink,
  findBytePlusAssetLink,
  resetBytePlusAssetLink,
  updateBytePlusAssetLink,
};

export function createBytePlusAssetTrustService({
  pool = getPool(),
  storage = createStorage(),
  assetsClientFactory = createBytePlusAssetsClient,
  repository = defaultRepository,
  env = process.env,
} = {}) {
  async function loadAsset(client, workspaceId, assetId, { lock = false } = {}) {
    const result = await client.query(
      `SELECT id, workspace_id, storage_key, filename, content_type
       FROM assets WHERE workspace_id = $1 AND id = $2 LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [workspaceId, assetId],
    );
    return result.rows[0] || null;
  }

  async function startTrust(workspaceId, assetId) {
    const provider = assetsClientFactory({ env });
    const client = await pool.connect();
    let prepared = false;
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      const asset = await loadAsset(client, workspaceId, assetId, { lock: true });
      if (!asset) {
        await client.query('COMMIT');
        inTransaction = false;
        return null;
      }
      if (!asset.content_type?.startsWith('image/')) {
        throw new BytePlusAssetTrustError('Only image assets can be trusted for Seedance.', {
          code: 'BYTEPLUS_ASSET_TYPE_UNSUPPORTED',
          status: 400,
        });
      }

      let link = await repository.findBytePlusAssetLink(client, workspaceId, assetId);
      if ((link?.status === 'active' && link.provider_asset_id) || (link?.status === 'processing' && link.provider_asset_id)) {
        await client.query('COMMIT');
        inTransaction = false;
        return projectBytePlusTrustState(link);
      }
      if (link?.status === 'failed' || link?.status === 'active') {
        link = await repository.resetBytePlusAssetLink(client, workspaceId, assetId);
      } else if (!link) {
        link = await repository.createProcessingBytePlusAssetLink(client, {
          workspaceId,
          localAssetId: assetId,
          projectName: env.BYTEPLUS_PROJECT_NAME?.trim() || 'default',
        });
      }
      prepared = true;

      let groupId = link.group_id;
      if (!groupId) {
        groupId = requireProviderId(await provider.createAssetGroup({
          name: asset.filename,
          description: 'NexoClip workspace asset',
        }));
        link = await repository.updateBytePlusAssetLink(client, {
          workspaceId,
          localAssetId: assetId,
          groupId,
          status: 'processing',
          error: null,
        });
      }

      if (!link.provider_asset_id) {
        const download = await storage.createDownloadUrl({
          key: asset.storage_key,
          expiresInSeconds: SOURCE_URL_TTL_SECONDS,
        });
        const sourceUrl = download?.url || download;
        const providerAssetId = requireProviderId(await provider.createAsset({
          groupId,
          url: sourceUrl,
          name: asset.filename,
        }));
        link = await repository.updateBytePlusAssetLink(client, {
          workspaceId,
          localAssetId: assetId,
          groupId,
          providerAssetId,
          status: 'processing',
          error: null,
        });
      }

      await client.query('COMMIT');
      inTransaction = false;
      return projectBytePlusTrustState(link);
    } catch (error) {
      if (inTransaction && prepared && error instanceof BytePlusAssetsError) {
        if (!error.retryable) {
          await repository.updateBytePlusAssetLink(client, {
            workspaceId,
            localAssetId: assetId,
            status: 'failed',
            error: { code: 'BYTEPLUS_ASSET_TRUST_FAILED', message: 'BytePlus could not trust this asset.' },
          });
        }
        await client.query('COMMIT');
      } else if (inTransaction) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function getTrust(workspaceId, assetId) {
    const client = await pool.connect();
    try {
      const asset = await loadAsset(client, workspaceId, assetId);
      if (!asset) return null;
      const link = await repository.findBytePlusAssetLink(client, workspaceId, assetId);
      if (!link) return { status: 'not_trusted' };
      if (link.status === 'active' && !link.provider_asset_id) {
        const failed = await repository.updateBytePlusAssetLink(client, {
          workspaceId,
          localAssetId: assetId,
          status: 'failed',
          error: INVALID_STATE_FAILURE,
        });
        return projectBytePlusTrustState(failed);
      }
      if (link.status !== 'processing' || !link.provider_asset_id) return projectBytePlusTrustState(link);

      const provider = assetsClientFactory({ env });
      const state = mapBytePlusAssetStatus(await provider.getAsset({ assetId: link.provider_asset_id }));
      const updated = await repository.updateBytePlusAssetLink(client, {
        workspaceId,
        localAssetId: assetId,
        status: state.status,
        error: state.error || null,
      });
      return projectBytePlusTrustState(updated);
    } finally {
      client.release();
    }
  }

  return { startTrust, getTrust };
}

export async function startBytePlusAssetTrust(workspaceId, assetId) {
  return createBytePlusAssetTrustService().startTrust(workspaceId, assetId);
}

export async function getBytePlusAssetTrust(workspaceId, assetId) {
  return createBytePlusAssetTrustService().getTrust(workspaceId, assetId);
}
