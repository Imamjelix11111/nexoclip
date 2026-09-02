import sharp from 'sharp';

const SUPPORTED_SECONDS = [4, 8, 12];
const SUPPORTED_SIZES = ['720x1280', '1280x720', '1024x1792', '1792x1024'];

function nearestSupportedSeconds(duration) {
  if (!duration) return undefined;
  return SUPPORTED_SECONDS.reduce((closest, value) => (
    Math.abs(value - duration) < Math.abs(closest - duration) ? value : closest
  ));
}

// OpenAI's video API takes a single `size` (e.g. "1280x720"), not our internal
// aspect_ratio/resolution pair — pick the closest supported size by orientation.
function sizeFor(aspectRatio, resolution) {
  const portrait = aspectRatio === '9:16';
  const landscape = aspectRatio === '16:9';
  const wide = resolution === '1080p' || resolution === '2K' || resolution === '4K';
  if (portrait) return wide ? '1024x1792' : '720x1280';
  if (landscape) return wide ? '1792x1024' : '1280x720';
  return undefined;
}

// Sora's `input_reference` is a starting frame, not a loose style reference — the API
// rejects it outright ("Inpaint image must match the requested width and height") unless
// its pixel dimensions exactly equal `size`. Pick the supported size closest to the
// reference photo's own aspect ratio (unless the caller already forced one via
// aspect_ratio/resolution), then cover-crop the photo to match exactly.
async function prepareReferenceImage(url, size, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw Object.assign(new Error(`Failed to fetch reference image: ${response.status}`), { status: 502 });
  const buffer = Buffer.from(await response.arrayBuffer());
  const targetSize = size || await sizeFromImage(buffer);
  const [width, height] = targetSize.split('x').map(Number);
  const resized = await sharp(buffer).resize(width, height, { fit: 'cover' }).jpeg().toBuffer();
  return { size: targetSize, dataUrl: `data:image/jpeg;base64,${resized.toString('base64')}` };
}

async function sizeFromImage(buffer) {
  const { width = 0, height = 0 } = await sharp(buffer).metadata();
  const portrait = height >= width;
  return portrait ? '720x1280' : '1280x720';
}

async function readErrorDetail(response) {
  try {
    const body = await response.json();
    return body?.error?.message || body?.message || null;
  } catch { return null; }
}

function requestFailedError(detail, status) {
  const suffix = detail ? `: ${detail}` : '';
  return Object.assign(new Error(`OpenAI video request failed${suffix}`), { provider: 'openai', status, code: 'OPENAI_VIDEO_FAILED' });
}

export function createOpenAIVideoAdapter({ apiKey, baseUrl = 'https://api.openai.com/v1', fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new TypeError('apiKey is required');
  const root = String(baseUrl).replace(/\/+$/, '');
  const authHeaders = { Authorization: `Bearer ${apiKey}` };

  return {
    async submit({ model, prompt, duration, resolution, aspectRatio, referenceImages } = {}) {
      if (!model || typeof model !== 'string') throw new TypeError('model is required');
      if (!prompt || typeof prompt !== 'string') throw new TypeError('prompt is required');
      const body = { model, prompt };
      const seconds = nearestSupportedSeconds(duration);
      if (seconds) body.seconds = String(seconds);
      const requestedSize = sizeFor(aspectRatio, resolution);
      const preferredSize = requestedSize && SUPPORTED_SIZES.includes(requestedSize) ? requestedSize : null;

      // Sora's input_reference takes exactly one image (file_id or image_url) — not a list —
      // and must be cover-cropped to exactly match `size` before it's sent.
      if (referenceImages?.length) {
        const { size, dataUrl } = await prepareReferenceImage(referenceImages[0], preferredSize, fetchImpl);
        body.size = size;
        body.input_reference = { image_url: dataUrl };
      } else if (preferredSize) {
        body.size = preferredSize;
      }

      let response;
      try {
        response = await fetchImpl(`${root}/videos`, { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch { throw requestFailedError(null, 503); }
      if (!response.ok) throw requestFailedError(await readErrorDetail(response), response.status);
      const payload = await response.json();
      return { ...payload, provider: 'openai' };
    },

    async poll(jobId) {
      if (!jobId) throw new TypeError('jobId is required');
      let response;
      try { response = await fetchImpl(`${root}/videos/${encodeURIComponent(jobId)}`, { headers: authHeaders }); }
      catch { throw requestFailedError(null, 503); }
      if (!response.ok) throw requestFailedError(await readErrorDetail(response), response.status);
      return response.json();
    },

    async downloadContent(jobId) {
      if (!jobId) throw new TypeError('jobId is required');
      let response;
      try { response = await fetchImpl(`${root}/videos/${encodeURIComponent(jobId)}/content`, { headers: authHeaders }); }
      catch { throw requestFailedError(null, 503); }
      if (!response.ok) throw requestFailedError(await readErrorDetail(response), response.status);
      return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'video/mp4' };
    },
  };
}
