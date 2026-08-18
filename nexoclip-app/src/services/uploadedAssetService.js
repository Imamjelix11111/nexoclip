import { randomUUID } from 'node:crypto';
import { getPool } from '../db/pool.js';
import { R2ObjectStorage } from '../storage/r2ObjectStorage.js';

function extensionFor(filename, contentType) {
  const fromName = (filename || '').split('.').pop();
  if (fromName && fromName.length <= 8 && /^[a-z0-9]+$/i.test(fromName)) return fromName.toLowerCase();
  const fromType = (contentType || '').split('/').pop();
  return fromType ? fromType.replace('+xml', '') : 'bin';
}

export async function persistUploadedAsset({ workspaceId, buffer, contentType, filename, storage = new R2ObjectStorage() }) {
  if (!workspaceId) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
  const extension = extensionFor(filename, contentType);
  const key = `${workspaceId}/uploads/${randomUUID()}.${extension}`;
  const url = await storage.put(key, buffer, contentType);
  const result = await getPool().query(
    `INSERT INTO assets (workspace_id, storage_key, filename, content_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, workspace_id, storage_key, filename, content_type, size_bytes, created_at`,
    [workspaceId, key, filename || key.split('/').pop(), contentType, buffer.length],
  );
  return { ...result.rows[0], url };
}
