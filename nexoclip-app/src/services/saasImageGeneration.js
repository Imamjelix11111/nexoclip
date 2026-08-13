import { randomUUID } from 'node:crypto';
import { createMuapiAdapter } from '../providers/muapi/adapter.js';
import { createGeneratedAsset } from '../repositories/assetMetadataRepository.js';
import { persistGenerationResult } from './generationOutputService.js';

export function createSaasImageHandler({ provider, storage, pool }) {
  if (!provider || !storage || !pool) throw new TypeError('provider, storage, and pool are required');
  return async (job) => {
    const result = await provider.submitGeneration({
      model: job.model,
      payload: { prompt: job.prompt, ...(job.parameters || {}) },
    });
    const providerRequestId = result.providerRequestId;
    if (!providerRequestId) throw Object.assign(new Error('Provider did not return a request id'), { code: 'PROVIDER_INVALID_RESPONSE' });
    const outputs = [];
    for (const [index, url] of (result.outputs || []).entries()) {
      const response = await fetch(url);
      if (!response.ok) throw Object.assign(new Error('Provider output download failed'), { code: 'PROVIDER_OUTPUT_UNAVAILABLE' });
      const body = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'image/png';
      const key = `${job.workspace_id}/${randomUUID()}`;
      const upload = await storage.createUploadUrl({ key, contentType });
      await storage.put(upload.url || upload, body, contentType);
      const client = await pool.connect();
      try {
        const asset = await createGeneratedAsset(client, {
          workspaceId: job.workspace_id, storageKey: key, filename: `generation-${job.id}-${index}.png`, contentType, sizeBytes: body.length,
        });
        outputs.push({ assetId: asset.id });
      } finally { client.release(); }
    }
    return { status: 'succeeded', providerRequestId, outputs, usage: result.usage || {} };
  };
}

export function createDefaultSaasImageHandler({ pool, storage }) {
  return createSaasImageHandler({
    pool, storage,
    provider: createMuapiAdapter({ apiKey: process.env.MUAPI_API_KEY, baseUrl: process.env.MUAPI_BASE_URL }),
  });
}
