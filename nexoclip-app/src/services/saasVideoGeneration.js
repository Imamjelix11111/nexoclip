import { randomUUID } from 'node:crypto';
import { createProviderRouter } from '../providers/providerRouter.js';
import { createGeneratedAsset } from '../repositories/assetMetadataRepository.js';
import { resolveReferenceImages } from './saasImageGeneration.js';

const TERMINAL_FAILURES = new Set(['failed', 'cancelled', 'expired']);

function videoRequest(job, { referenceImages, frameImages, referenceVideos }) {
  const parameters = job.parameters || {};
  const framed = frameImages.map((url, index) => ({
    type: 'image_url', image_url: { url }, frame_type: parameters.frameImages[index].frameType,
  }));
  return {
    model: job.model, prompt: job.prompt,
    ...(parameters.duration !== undefined ? { duration: Number(parameters.duration) } : {}),
    ...(parameters.resolution ? { resolution: parameters.resolution } : {}),
    ...(parameters.aspectRatio ? { aspectRatio: parameters.aspectRatio } : {}),
    ...(parameters.seed !== undefined ? { seed: parameters.seed } : {}),
    ...(framed.length ? { frameImages: framed } : {}),
    ...(referenceImages.length ? { referenceImages } : {}),
    ...(referenceVideos.length ? { referenceVideos } : {}),
  };
}

export function createSaasVideoHandler({ pool, storage, providerRouter, createAsset = createGeneratedAsset, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollIntervalMs = 5_000, maxPolls = 120 }) {
  if (!pool || !storage || !providerRouter) throw new TypeError('pool, storage, and provider router are required');
  return async (job) => {
    const referenceImages = await resolveReferenceImages({ workspaceId: job.workspace_id, referenceImages: job.parameters?.referenceImages, pool, storage });
    const frameImages = await resolveReferenceImages({ workspaceId: job.workspace_id, referenceImages: (job.parameters?.frameImages || []).map((frame) => frame.url), pool, storage });
    const referenceVideos = await resolveReferenceImages({ workspaceId: job.workspace_id, referenceImages: job.parameters?.referenceVideos, pool, storage });
    const submitted = await providerRouter.submitVideo(videoRequest(job, { referenceImages, frameImages, referenceVideos }));
    const provider = submitted.provider || 'openrouter';
    const providerRequestId = submitted.id || submitted.providerRequestId;
    if (!providerRequestId) throw Object.assign(new Error('Provider returned no video request id'), { code: 'PROVIDER_INVALID_RESPONSE' });
    let status;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      status = await providerRouter.pollVideo(provider, providerRequestId);
      if (status?.status === 'completed') break;
      if (TERMINAL_FAILURES.has(status?.status)) throw Object.assign(new Error('Video provider generation failed'), { code: 'PROVIDER_GENERATION_FAILED' });
      await sleep(pollIntervalMs);
    }
    if (status?.status !== 'completed') throw Object.assign(new Error('Video provider generation timed out'), { code: 'GENERATION_TIMEOUT' });
    const output = await providerRouter.downloadVideo(provider, providerRequestId, 0);
    const key = `${job.workspace_id}/${randomUUID()}`;
    const contentType = output.contentType || 'video/mp4';
    const upload = await storage.createUploadUrl({ key, contentType });
    await storage.put(upload.url || upload, output.buffer, contentType);
    const client = await pool.connect();
    try {
      const asset = await createAsset(client, { workspaceId: job.workspace_id, storageKey: key, filename: `generation-${job.id}.mp4`, contentType, sizeBytes: output.buffer.length });
      return { status: 'succeeded', provider, providerRequestId, outputs: [{ assetId: asset.id }], usage: submitted.usage || {} };
    } finally { client.release(); }
  };
}

export function createDefaultSaasVideoHandler({ pool, storage, providerRouter = createProviderRouter() }) {
  return createSaasVideoHandler({ pool, storage, providerRouter });
}
