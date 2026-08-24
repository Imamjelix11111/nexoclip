const DEFAULT_BASE_URL = 'https://openrouter.ai';

const ERROR_MESSAGES = {
  401: ['OPENROUTER_AUTHENTICATION_FAILED', 'OpenRouter authentication failed'],
  403: ['OPENROUTER_AUTHORIZATION_FAILED', 'OpenRouter authorization failed'],
  404: ['OPENROUTER_NOT_FOUND', 'OpenRouter model or endpoint not found'],
};

// Most video-editing models take their source video as an input_references entry
// of type 'video_url' (confirmed live for runway/aleph-2). Alibaba's Wan 2.7 is an
// exception — confirmed live that it rejects a video_url input_reference with
// "does not accept video input references", but accepts a raw top-level `video`
// field instead (one of its documented passthrough parameters).
const VIDEO_PASSTHROUGH_FIELD = {
  'alibaba/wan-2.7': 'video',
};

const MODEL_UNAVAILABLE_PATTERN = /model/i;
const UNAVAILABLE_REASON_PATTERN = /(not found|not a valid|unsupported|unavailable|does not exist|no endpoints)/i;
function isModelUnavailableDetail(detail) {
  return MODEL_UNAVAILABLE_PATTERN.test(detail) && UNAVAILABLE_REASON_PATTERN.test(detail);
}

function normalizeError(status) {
  const [code, message] = ERROR_MESSAGES[status] || [
    status >= 500 ? 'OPENROUTER_UNAVAILABLE' : 'OPENROUTER_REQUEST_FAILED',
    status >= 500 ? 'OpenRouter is temporarily unavailable' : 'OpenRouter request failed',
  ];
  return { code, status, message };
}

async function normalizeSubmitError(response) {
  const status = response.status;
  if (ERROR_MESSAGES[status]) {
    const [code, message] = ERROR_MESSAGES[status];
    return { code, status, message };
  }
  if (status === 400) {
    let detail = '';
    try { const body = await response.json(); detail = body?.error?.message || body?.message || ''; } catch { /* no readable body */ }
    if (isModelUnavailableDetail(detail)) {
      return { code: 'OPENROUTER_MODEL_UNAVAILABLE', status, message: 'OpenRouter has no route for this model' };
    }
    return { code: 'OPENROUTER_REQUEST_FAILED', status, message: 'OpenRouter request failed' };
  }
  return normalizeError(status);
}

export function createOpenRouterVideoAdapter({ baseUrl = DEFAULT_BASE_URL, apiKey, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey || typeof apiKey !== 'string') throw new TypeError('apiKey is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
  const root = String(baseUrl).replace(/\/+$/, '');
  const authHeaders = { Authorization: `Bearer ${apiKey}` };

  return {
    async submit({ model, prompt, duration, resolution, aspectRatio, generateAudio, seed, frameImages, referenceImages, referenceVideos } = {}) {
      if (!model || typeof model !== 'string') throw new TypeError('model is required');
      if (!prompt || typeof prompt !== 'string') throw new TypeError('prompt is required');
      const body = { model, prompt };
      if (duration !== undefined) body.duration = duration;
      if (resolution) body.resolution = resolution;
      if (aspectRatio) body.aspect_ratio = aspectRatio;
      if (generateAudio !== undefined) body.generate_audio = generateAudio;
      if (seed !== undefined) body.seed = seed;
      if (frameImages?.length) body.frame_images = frameImages;
      const imageRefs = (referenceImages || []).map((url) => ({ type: 'image_url', image_url: { url } }));
      const passthroughField = VIDEO_PASSTHROUGH_FIELD[model];
      if (passthroughField && referenceVideos?.length) {
        body[passthroughField] = referenceVideos[0];
        if (imageRefs.length) body.input_references = imageRefs;
      } else {
        const videoRefs = (referenceVideos || []).map((url) => ({ type: 'video_url', video_url: { url } }));
        if (imageRefs.length || videoRefs.length) body.input_references = [...videoRefs, ...imageRefs];
      }

      let response;
      try {
        response = await fetchImpl(`${root}/api/v1/videos`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        throw normalizeError(503);
      }
      if (!response.ok) throw await normalizeSubmitError(response);
      return response.json();
    },

    async poll(jobId) {
      if (!jobId || typeof jobId !== 'string') throw new TypeError('jobId is required');
      let response;
      try {
        response = await fetchImpl(`${root}/api/v1/videos/${encodeURIComponent(jobId)}`, { headers: authHeaders });
      } catch {
        throw normalizeError(503);
      }
      if (!response.ok) throw normalizeError(response.status);
      return response.json();
    },

    async downloadContent(jobId, index = 0) {
      if (!jobId || typeof jobId !== 'string') throw new TypeError('jobId is required');
      let response;
      try {
        response = await fetchImpl(`${root}/api/v1/videos/${encodeURIComponent(jobId)}/content?index=${encodeURIComponent(index)}`, {
          headers: authHeaders,
        });
      } catch {
        throw normalizeError(503);
      }
      if (!response.ok) throw normalizeError(response.status);
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'video/mp4';
      return { buffer, contentType };
    },
  };
}
