import type {Artifact, JsonValue} from './types';

export async function getJsonArtifact(artifact: Artifact): Promise<JsonValue> {
  const separator = artifact.url.includes('?') ? '&' : '?';
  const response = await fetch(`${artifact.url}${separator}updated=${encodeURIComponent(artifact.updatedAt)}`, {
    cache: 'no-store',
    headers: {Accept: 'application/json'},
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as JsonValue;
}

export type VimaxJobRequest = {
  kind: 'vimax_narrative_planning' | 'vimax_novel_planning' | 'vimax_render_video';
  sessionId: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
};

export async function submitVimaxJob(input: VimaxJobRequest) {
  return request<{id: string; status: string}>('/api/vimax/jobs', {method: 'POST', body: JSON.stringify(input)});
}

export async function getVimaxJob(generationId: string) {
  return request<{generation: {id: string; status: string; progress?: {stage?: string; message?: string}; result?: Record<string, unknown>}}>(`/api/vimax/jobs/${encodeURIComponent(generationId)}`);
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {'Content-Type': 'application/json', ...(init.headers || {})},
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  return payload as T;
}
