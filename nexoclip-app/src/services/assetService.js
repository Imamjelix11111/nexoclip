import { randomUUID } from 'node:crypto';
import { getPool } from '../db/pool.js';
import { LocalObjectStorage } from '../storage/localObjectStorage.js';
import { listAssets } from '../repositories/assetMetadataRepository.js';

const allowedContentTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/wav']);
const maxSizeBytes = 50 * 1024 * 1024;

export function validateAssetInput(input) {
  const filename = String(input?.filename || '').trim();
  const contentType = String(input?.contentType || '').trim().toLowerCase();
  const sizeBytes = Number(input?.sizeBytes);
  if (!filename) throw new Error('Asset filename is required');
  if (!allowedContentTypes.has(contentType)) throw new Error('Asset content type is not supported');
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxSizeBytes) throw new Error('Asset size is invalid');
  return { filename, contentType, sizeBytes };
}

export function createStorage() {
  return new LocalObjectStorage({
    root: process.env.LOCAL_OBJECT_STORAGE_DIR || '.local-object-storage',
    secret: process.env.LOCAL_OBJECT_STORAGE_SECRET || 'development-only-change-me',
  });
}

export async function createAssetUpload(workspaceId, input, storage = createStorage()) {
  const metadata = validateAssetInput(input);
  const assetId = randomUUID();
  const key = `${workspaceId}/${assetId}`;
  const upload = await storage.createUploadUrl({ key, contentType: metadata.contentType });
  const result = await getPool().query(
    `INSERT INTO assets (id, workspace_id, storage_key, filename, content_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, workspace_id, storage_key, filename, content_type, size_bytes, created_at`,
    [assetId, workspaceId, key, metadata.filename, metadata.contentType, metadata.sizeBytes],
  );
  return { asset: result.rows[0], upload };
}

export async function listWorkspaceAssets(workspaceId) {
  if (!workspaceId) throw new Error('workspace_id is required');
  const result = await getPool().query(
    `SELECT id, workspace_id, storage_key, filename, content_type, size_bytes, created_at
     FROM assets WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows.map((asset) => ({
    ...asset,
    url: `/api/assets/${encodeURIComponent(asset.id)}/download?workspace_id=${encodeURIComponent(workspaceId)}`,
  }));
}

export async function createAssetDownload(workspaceId, assetId, storage = createStorage()) {
  if (!workspaceId) throw new Error('workspace_id is required');
  if (!assetId) throw new Error('asset_id is required');
  const result = await getPool().query(
    'SELECT id, workspace_id, storage_key, filename, content_type, size_bytes, created_at FROM assets WHERE workspace_id = $1 AND id = $2 LIMIT 1',
    [workspaceId, assetId],
  );
  const asset = result.rows[0];
  if (!asset) return null;
  return { asset, download: await storage.createDownloadUrl({ key: asset.storage_key }) };
}
