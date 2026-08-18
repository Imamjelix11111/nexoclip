const DEFAULT_BASE_URL = 'https://openrouter.ai';

const ERROR_MESSAGES = {
  401: ['OPENROUTER_AUTHENTICATION_FAILED', 'OpenRouter authentication failed'],
  403: ['OPENROUTER_AUTHORIZATION_FAILED', 'OpenRouter authorization failed'],
  404: ['OPENROUTER_NOT_FOUND', 'OpenRouter model or endpoint not found'],
};

function normalizeError(status) {
  const [code, message] = ERROR_MESSAGES[status] || [
    status >= 500 ? 'OPENROUTER_UNAVAILABLE' : 'OPENROUTER_REQUEST_FAILED',
    status >= 500 ? 'OpenRouter is temporarily unavailable' : 'OpenRouter request failed',
  ];
  return { code, status, message };
}

export function createOpenRouterVideoAdapter({ baseUrl = DEFAULT_BASE_URL, apiKey, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey || typeof apiKey !== 'string') throw new TypeError('apiKey is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
  const root = String(baseUrl).replace(/\/+$/, '');
  const authHeaders = { Authorization: `Bearer ${apiKey}` };

  return {
    async submit({ model, prompt, duration, resolution, aspectRatio, generateAudio, seed, frameImages, referenceImages } = {}) {
      if (!model || typeof model !== 'string') throw new TypeError('model is required');
      if (!prompt || typeof prompt !== 'string') throw new TypeError('prompt is required');
      const body = { model, prompt };
      if (duration !== undefined) body.duration = duration;
      if (resolution) body.resolution = resolution;
      if (aspectRatio) body.aspect_ratio = aspectRatio;
      if (generateAudio !== undefined) body.generate_audio = generateAudio;
      if (seed !== undefined) body.seed = seed;
      if (frameImages?.length) body.frame_images = frameImages;
      if (referenceImages?.length) {
        body.input_references = referenceImages.map((url) => ({ type: 'image_url', image_url: { url } }));
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
      if (!response.ok) throw normalizeError(response.status);
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
