function normalizeImagePayload(payload) {
  const images = payload?.data || payload?.predictions || (payload?.candidates || []).flatMap((candidate) => candidate?.content?.parts || []).map((part) => part?.inlineData).filter(Boolean);
  return images.map((image) => {
    const mimeType = image.mimeType || image.mime_type || 'image/png';
    if (image.b64_json || image.bytesBase64Encoded || image.data) return { url: `data:${mimeType};base64,${image.b64_json || image.bytesBase64Encoded || image.data}`, mimeType };
    if (image.url) return { url: image.url, mimeType };
    return null;
  }).filter(Boolean);
}

function transientError(provider, error, detail) {
  const suffix = detail ? `: ${detail}` : '';
  return Object.assign(new Error(`${provider} image request failed${suffix}`), { provider, status: error?.status || 503, code: `${provider.toUpperCase()}_IMAGE_FAILED` });
}

async function readErrorDetail(response) {
  try {
    const body = await response.json();
    return body?.error?.message || body?.message || null;
  } catch { return null; }
}

async function fetchAsBlob(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw Object.assign(new Error(`Failed to fetch reference image: ${response.status}`), { status: 502 });
  const contentType = response.headers.get('content-type') || 'image/png';
  const buffer = await response.arrayBuffer();
  return new Blob([buffer], { type: contentType });
}

export function createOpenAIImageAdapter({ apiKey, baseUrl = 'https://api.openai.com/v1', fetch: fetchImpl = globalThis.fetch } = {}) {
  return { async generate({ model, prompt, size, quality, referenceImages }) {
    const root = String(baseUrl).replace(/\/+$/, '');
    let response;
    try {
      if (referenceImages?.length) {
        // Reference images require the edits endpoint (multipart) — /images/generations is text-only.
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', prompt);
        if (size) form.append('size', size);
        if (quality) form.append('quality', quality);
        const blobs = await Promise.all(referenceImages.map((url) => fetchAsBlob(url, fetchImpl)));
        blobs.forEach((blob, i) => form.append('image[]', blob, `reference-${i}.png`));
        response = await fetchImpl(`${root}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
      } else {
        response = await fetchImpl(`${root}/images/generations`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt, ...(size ? { size } : {}), ...(quality ? { quality } : {}) }) });
      }
    } catch (error) { throw transientError('openai', error); }
    if (!response.ok) throw transientError('openai', response, await readErrorDetail(response));
    const outputs = normalizeImagePayload(await response.json());
    if (!outputs.length) throw Object.assign(new Error('OpenAI returned no images'), { code: 'OPENAI_INVALID_RESPONSE', status: 502 });
    return { provider: 'openai', status: 'succeeded', outputs };
  } };
}

export function createBytePlusImageAdapter({ apiKey, baseUrl, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) throw new TypeError('baseUrl is required');
  const root = String(baseUrl).replace(/\/+$/, '');
  return { async generate({ model, prompt, resolution, referenceImages }) {
    // BytePlus `size` only accepts 'WIDTHxHEIGHT' or a supported resolution preset,
    // never an aspect ratio like '16:9'. The Seedream 4.5 deployment starts at 2K.
    const size = model === 'ep-20260907150312-xx7gf' && resolution?.toUpperCase() === '1K'
      ? '2K'
      : resolution;
    let response;
    try {
      response = await fetchImpl(`${root}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, prompt, response_format: 'url',
          ...(size ? { size } : {}),
          ...(referenceImages?.length ? { image: referenceImages } : {}),
        }),
      });
    } catch (error) { throw transientError('byteplus', error); }
    if (!response.ok) throw transientError('byteplus', response, await readErrorDetail(response));
    const outputs = normalizeImagePayload(await response.json());
    if (!outputs.length) throw Object.assign(new Error('BytePlus returned no images'), { code: 'BYTEPLUS_INVALID_RESPONSE', status: 502 });
    return { provider: 'byteplus', status: 'succeeded', outputs };
  } };
}

async function fetchAsInlineData(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw Object.assign(new Error(`Failed to fetch reference image: ${response.status}`), { status: 502 });
  const mimeType = response.headers.get('content-type') || 'image/png';
  const buffer = await response.arrayBuffer();
  return { inlineData: { mimeType, data: Buffer.from(buffer).toString('base64') } };
}

export function createGoogleImageAdapter({ apiKey, baseUrl = 'https://generativelanguage.googleapis.com/v1beta', fetch: fetchImpl = globalThis.fetch } = {}) {
  return { async generate({ model, prompt, aspectRatio, resolution, referenceImages }) {
    let response;
    try {
      // Reference images must ride as inlineData parts ahead of the text part — Gemini's
      // generateContent has no separate "reference image" field, image conditioning only
      // works via multimodal parts in the same request.
      const imageParts = referenceImages?.length ? await Promise.all(referenceImages.map((url) => fetchAsInlineData(url, fetchImpl))) : [];
      response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [...imageParts, { text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...((aspectRatio || resolution) ? { imageConfig: { ...(aspectRatio ? { aspectRatio } : {}), ...(resolution ? { imageSize: resolution } : {}) } } : {}) } }) });
    } catch (error) { throw transientError('google', error); }
    if (!response.ok) {
      const detail = await response.text().catch(() => 'Unable to read provider error');
      let safeDetail = detail;
      try {
        const parsed = JSON.parse(detail);
        safeDetail = parsed?.error?.message || parsed?.message || detail;
      } catch {
        // Keep non-JSON provider response as-is.
      }
      console.error('[google-image] provider request failed', {
        status: response.status,
        detail: String(safeDetail).slice(0, 1000),
      });
      throw Object.assign(new Error(`Google image request failed: ${String(safeDetail).slice(0, 300)}`), {
        provider: 'google',
        status: response.status,
        code: 'GOOGLE_IMAGE_FAILED',
      });
    }
    const outputs = normalizeImagePayload(await response.json());
    if (!outputs.length) throw Object.assign(new Error('Google returned no images'), { code: 'GOOGLE_INVALID_RESPONSE', status: 502 });
    return { provider: 'google', status: 'succeeded', outputs };
  } };
}
