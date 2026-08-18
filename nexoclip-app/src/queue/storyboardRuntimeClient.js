const KINDS = new Set(['vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video']);
const INPUT_KEYS = {
  vimax_narrative_planning: new Set(['idea', 'script', 'user_requirement', 'style', 'revision_target', 'revision_instruction']),
  vimax_novel_planning: new Set(['novel_text', 'style']),
  vimax_render_video: new Set(['render_mode', 'scene_index']),
};

function safeInput(kind, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([key]) => INPUT_KEYS[kind].has(key)));
}

function runtimeError(status) {
  const error = new Error(`Storyboard runtime request failed with status ${status}`);
  error.code = status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'RUNTIME_REQUEST_FAILED';
  error.retryable = status >= 500;
  return error;
}

export function createStoryboardRuntimeClient({ baseUrl, token, fetch = globalThis.fetch, timeoutMs = 10 * 60 * 1000, progressCallbackUrl = '', progressToken = '' }) {
  if (!baseUrl || !token || typeof fetch !== 'function') throw new TypeError('baseUrl, token, and fetch are required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new RangeError('timeoutMs must be positive');

  const base = baseUrl.replace(/\/$/, '');
  return {
    async execute(job, {onProgress} = {}) {
      if (!job?.id || !job.workspace_id || !KINDS.has(job.kind)) throw new TypeError('job id, workspace_id, and supported kind are required');
      const parameters = job.parameters && typeof job.parameters === 'object' ? job.parameters : {};
      let response;
      try {
        response = await fetch(`${base}/internal/v1/jobs/${encodeURIComponent(job.id)}/execute`, {
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'Content-Type': 'application/json',
            'X-NexoClip-Runtime-Token': token,
          },
          body: JSON.stringify({
            workspace_id: job.workspace_id,
            kind: job.kind,
            session_id: typeof parameters.sessionId === 'string' ? parameters.sessionId : '',
            input: safeInput(job.kind, parameters.input),
            attempt: Number(job.attempt_count),
            claim_token: job.claim_token,
            ...(progressCallbackUrl && progressToken ? {progress_callback: {url: `${progressCallbackUrl.replace(/\/$/, '')}/${encodeURIComponent(job.id)}`, token: progressToken}} : {}),
          }),
        });
      } catch (error) {
        const timeout = error?.name === 'AbortError' || error?.name === 'TimeoutError';
        const safeError = new Error(timeout ? 'Storyboard runtime request timed out' : 'Storyboard runtime is unavailable');
        safeError.code = timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE';
        safeError.retryable = true;
        throw safeError;
      }
      if (!response.ok) throw runtimeError(response.status);
      const payload = await response.json();
      for (const event of payload.progress || []) await onProgress?.(event);
      return payload;
    },
  };
}
