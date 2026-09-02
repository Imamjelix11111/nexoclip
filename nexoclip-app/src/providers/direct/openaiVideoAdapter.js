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
      const size = sizeFor(aspectRatio, resolution);
      if (size && SUPPORTED_SIZES.includes(size)) body.size = size;
      // Sora's input_reference takes exactly one image (file_id or image_url) — not a list.
      if (referenceImages?.length) body.input_reference = { image_url: referenceImages[0] };

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
