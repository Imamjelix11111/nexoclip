const DEFAULT_BASE_URL = 'https://api.muapi.ai';

const STATUS = {
  400: 'PROVIDER_INVALID_REQUEST',
  401: 'PROVIDER_AUTHENTICATION_FAILED',
  403: 'PROVIDER_AUTHORIZATION_FAILED',
  404: 'PROVIDER_NOT_FOUND',
  408: 'PROVIDER_TIMEOUT',
};

function trimBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function providerId(body) {
  return body?.request_id || body?.id || body?.prediction_id || null;
}

function outputs(body) {
  if (Array.isArray(body?.outputs)) return body.outputs.filter((value) => typeof value === 'string');
  const url = body?.url || body?.output?.url || body?.output;
  return typeof url === 'string' ? [url] : [];
}

function normalizeResult(body = {}) {
  const result = {
    providerRequestId: providerId(body),
    status: typeof body.status === 'string' ? body.status.toLowerCase() : 'unknown',
  };
  const resultOutputs = outputs(body);
  if (resultOutputs.length) result.outputs = resultOutputs;

  const cost = body.cost ?? body.usage?.cost ?? body.usage?.total_cost;
  const providerUsage = body.usage && typeof body.usage === 'object' ? body.usage : {};
  if (typeof cost === 'number' || (typeof cost === 'string' && cost.trim() !== '')) {
    result.usage = { cost };
    if (body.usage && typeof body.usage === 'object') {
      if (providerUsage.units && typeof providerUsage.units === 'object') result.usage.units = providerUsage.units;
      result.usage.rawUsage = providerUsage;
    }
  }
  return result;
}

function normalizeError(error, status) {
  if (error && typeof error === 'object' && error.code && error.message) return error;
  const code = STATUS[status] || (status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REQUEST_FAILED');
  const message = code === 'PROVIDER_AUTHENTICATION_FAILED'
    ? 'MuAPI authentication failed'
    : code === 'PROVIDER_AUTHORIZATION_FAILED'
      ? 'MuAPI authorization failed'
      : code === 'PROVIDER_UNAVAILABLE'
        ? 'MuAPI is temporarily unavailable'
        : 'MuAPI request failed';
  return { code, ...(Number.isInteger(status) ? { status } : {}), message };
}

export function createMuapiAdapter({ baseUrl = DEFAULT_BASE_URL, apiKey, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey || typeof apiKey !== 'string') throw new TypeError('apiKey is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
  const root = trimBaseUrl(baseUrl);
  const headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey };

  async function request(path, options = {}) {
    try {
      const response = await fetchImpl(`${root}${path}`, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
      });
      let body = null;
      try { body = await response.json(); } catch { /* empty/non-JSON response */ }
      if (!response.ok) throw normalizeError(null, response.status);
      return body || {};
    } catch (error) {
      if (error?.code) throw error;
      throw normalizeError(error);
    }
  }

  return {
    async submitGeneration({ model, payload }) {
      if (!model || typeof model !== 'string') throw new TypeError('model is required');
      const result = await request(`/api/v1/${encodeURIComponent(model)}`, {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      });
      return normalizeResult(result);
    },

    async getGenerationStatus(providerRequestId) {
      if (!providerRequestId) throw new TypeError('providerRequestId is required');
      return normalizeResult(await request(`/api/v1/predictions/${encodeURIComponent(providerRequestId)}/result`, { method: 'GET' }));
    },

    async cancelGeneration(providerRequestId) {
      if (!providerRequestId) throw new TypeError('providerRequestId is required');
      return normalizeResult(await request(`/api/v1/predictions/${encodeURIComponent(providerRequestId)}`, { method: 'DELETE' }));
    },

    normalizeResult,
    normalizeError,
  };
}
