const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function errorFor(response, provider) {
  const error = Object.assign(new Error(`${provider} direct request failed`), { provider, status: response.status });
  error.code = response.status >= 500 ? `${provider.toUpperCase()}_UNAVAILABLE` : `${provider.toUpperCase()}_REQUEST_FAILED`;
  return error;
}

export function createOpenAIAdapter({ apiKey, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new TypeError('apiKey is required');
  return {
    async generate({ model, prompt }) {
      const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
      }).catch(() => { throw Object.assign(new Error('OpenAI direct request failed'), { provider: 'openai', status: 503, code: 'OPENAI_UNAVAILABLE' }); });
      if (!response.ok) throw errorFor(response, 'openai');
      const payload = await response.json();
      return { provider: 'openai', output: payload.choices?.[0]?.message?.content ?? '', raw: payload };
    },
  };
}
