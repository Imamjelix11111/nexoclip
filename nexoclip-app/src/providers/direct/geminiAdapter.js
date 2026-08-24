const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export function createGeminiAdapter({ apiKey, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new TypeError('apiKey is required');
  return {
    async generate({ model, prompt }) {
      const root = String(baseUrl).replace(/\/+$/, '');
      const response = await fetchImpl(`${root}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }).catch(() => { throw Object.assign(new Error('Gemini direct request failed'), { provider: 'gemini', status: 503, code: 'GEMINI_UNAVAILABLE' }); });
      if (!response.ok) throw Object.assign(new Error('Gemini direct request failed'), { provider: 'gemini', status: response.status, code: 'GEMINI_REQUEST_FAILED' });
      const payload = await response.json();
      return { provider: 'gemini', output: payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '', raw: payload };
    },
  };
}
