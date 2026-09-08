import { randomUUID } from 'node:crypto';
import { createProviderRouter } from '../providers/providerRouter.js';
import { createGeneratedAsset } from '../repositories/assetMetadataRepository.js';

function imageRequest(job) {
  const parameters = job.parameters || {};
  return {
    model: job.model,
    prompt: job.prompt,
    ...(parameters.aspectRatio ? { aspectRatio: parameters.aspectRatio } : {}),
    ...(parameters.resolution ? { resolution: parameters.resolution } : {}),
    ...(parameters.quality ? { quality: parameters.quality } : {}),
    ...(parameters.seed !== undefined ? { seed: parameters.seed } : {}),
    ...(parameters.referenceImages?.length ? { referenceImages: parameters.referenceImages } : {}),
  };
}

async function downloadOutput(output) {
  const url = typeof output === 'string' ? output : output?.url;
  if (!url) throw Object.assign(new Error('Provider returned an invalid image output'), { code: 'PROVIDER_INVALID_RESPONSE' });
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)?;base64,(.+)$/);
    if (!match) throw Object.assign(new Error('Provider returned an invalid data image'), { code: 'PROVIDER_INVALID_RESPONSE' });
    return { body: Buffer.from(match[2], 'base64'), contentType: match[1] || output?.mimeType || 'image/png' };
  }
  const response = await fetch(url);
  if (!response.ok) throw Object.assign(new Error('Provider output download failed'), { code: 'PROVIDER_OUTPUT_UNAVAILABLE' });
  return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || output?.mimeType || 'image/png' };
}

export function createSaasImageHandler({ providerRouter, provider, storage, pool }) {
  if ((!providerRouter && !provider) || !storage || !pool) throw new TypeError('provider router, storage, and pool are required');
  return async (job) => {
    const result = providerRouter
      ? await providerRouter.generateImage(imageRequest(job))
      : await provider.submitGeneration({ model: job.model, payload: { prompt: job.prompt, ...(job.parameters || {}) } });
    const providerRequestId = result.providerRequestId || `${result.provider || 'provider'}:${job.id}`;
    const savedOutputs = [];
    for (const [index, output] of (result.outputs || []).entries()) {
      const { body, contentType } = await downloadOutput(output);
      const key = `${job.workspace_id}/${randomUUID()}`;
      const upload = await storage.createUploadUrl({ key, contentType });
      await storage.put(upload.url || upload, body, contentType);
      const client = await pool.connect();
      try {
        const asset = await createGeneratedAsset(client, {
          workspaceId: job.workspace_id, storageKey: key, filename: `generation-${job.id}-${index}.png`, contentType, sizeBytes: body.length,
        });
        savedOutputs.push({ assetId: asset.id });
      } finally { client.release(); }
    }
    if (!savedOutputs.length) throw Object.assign(new Error('Provider returned no image outputs'), { code: 'PROVIDER_INVALID_RESPONSE' });
    return { status: 'succeeded', provider: result.provider || 'muapi', providerRequestId, outputs: savedOutputs, usage: result.usage || {} };
  };
}

export function createDefaultSaasImageHandler({ pool, storage, providerRouter = createProviderRouter() }) {
  return createSaasImageHandler({ pool, storage, providerRouter });
}
