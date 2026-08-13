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

function normalizeImage(image) {
  const mimeType = image?.media_type || 'image/png';
  if (typeof image?.b64_json === 'string') {
    return { url: `data:${mimeType};base64,${image.b64_json}`, mimeType };
  }
  if (typeof image?.url === 'string') return { url: image.url, mimeType };
  throw Object.assign(new Error('OpenRouter returned an invalid image'), { code: 'OPENROUTER_INVALID_RESPONSE' });
}

export function createOpenRouterImageAdapter({ baseUrl = DEFAULT_BASE_URL, apiKey, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey || typeof apiKey !== 'string') throw new TypeError('apiKey is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
  const root = String(baseUrl).replace(/\/+$/, '');

  return {
    async generate({ model, prompt, aspectRatio, resolution, quality, seed, referenceImages } = {}) {
      if (!model || typeof model !== 'string') throw new TypeError('model is required');
      if (!prompt || typeof prompt !== 'string') throw new TypeError('prompt is required');
      const body = { model, prompt };
      if (aspectRatio) body.aspect_ratio = aspectRatio;
      if (resolution) body.resolution = resolution;
      if (quality) body.quality = quality;
      if (seed !== undefined) body.seed = seed;
      if (referenceImages?.length) {
        body.input_references = referenceImages.map((url) => ({ type: 'image_url', image_url: { url } }));
      }

      let response;
      try {
        response = await fetchImpl(`${root}/api/v1/images`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        throw normalizeError(503);
      }
      if (!response.ok) throw normalizeError(response.status);
      const payload = await response.json();
      const outputs = (payload.data || []).map(normalizeImage);
      if (!outputs.length) throw Object.assign(new Error('OpenRouter returned no images'), { code: 'OPENROUTER_INVALID_RESPONSE' });
      return {
        provider: 'openrouter',
        status: 'succeeded',
        providerRequestId: payload.id || (payload.created == null ? null : String(payload.created)),
        outputs,
        usage: payload.usage && typeof payload.usage === 'object' ? {
          ...(payload.usage.cost !== undefined ? { cost: payload.usage.cost } : {}),
          ...(payload.usage.total_tokens !== undefined ? { total_tokens: payload.usage.total_tokens } : {}),
        } : {},
      };
    },
  };
}
