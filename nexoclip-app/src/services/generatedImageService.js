import { randomUUID } from 'node:crypto';
import { getPool } from '../db/pool.js';
import { R2ObjectStorage } from '../storage/r2ObjectStorage.js';

function contentTypeFromDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(value || '');
  if (!match) throw Object.assign(new Error('Generated image format is unsupported'), { code: 'INVALID_IMAGE_OUTPUT', status: 502 });
  return match[1];
}

export async function persistGeneratedImage({ workspaceId, dataUrl, storage = new R2ObjectStorage() }) {
  if (!workspaceId) throw Object.assign(new Error('workspace_id is required'), { status: 400 });
  const contentType = contentTypeFromDataUrl(dataUrl);
  const body = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.slice('image/'.length);
  const key = `${workspaceId}/generated/${randomUUID()}.${extension}`;
  const url = await storage.put(key, body, contentType);
  const result = await getPool().query(
    `INSERT INTO assets (workspace_id, storage_key, filename, content_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, workspace_id, storage_key, filename, content_type, size_bytes, created_at`,
    [workspaceId, key, key.split('/').pop(), contentType, body.length],
  );
  return { ...result.rows[0], url };
}
