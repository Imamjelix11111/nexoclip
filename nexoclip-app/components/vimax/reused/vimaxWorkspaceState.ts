// Pure, DOM-free helpers for persisting the durable render job that belongs to a
// storyboard session. Kept free of React/browser globals so refresh behaviour can
// be tested with a plain Map (see tests/components/vimaxWorkspaceState.test.mjs).

import type {DurableResultArtifact} from './types';

export type StoredJob = {id: string; status: string};
type StoredJobs = Record<string, StoredJob>;

export const STORAGE_KEY = 'vimax-durable-jobs';

// Accepts either a Web Storage (getItem/setItem) or a Map-like (get/set) backend,
// so the same helpers work with window.localStorage and with an in-memory Map.
export type JobStorage = {
  getItem?: (key: string) => string | null | undefined;
  setItem?: (key: string, value: string) => void;
  get?: (key: string) => string | null | undefined;
  set?: (key: string, value: string) => void;
};

function readRaw(storage: JobStorage | undefined | null, key: string): string | null {
  if (!storage) return null;
  try {
    if (typeof storage.getItem === 'function') return storage.getItem(key) ?? null;
    if (typeof storage.get === 'function') return storage.get(key) ?? null;
  } catch {
    return null;
  }
  return null;
}

function writeRaw(storage: JobStorage | undefined | null, key: string, value: string): void {
  if (!storage) return;
  try {
    if (typeof storage.setItem === 'function') storage.setItem(key, value);
    else if (typeof storage.set === 'function') storage.set(key, value);
  } catch {
    // Ignore unavailable/full storage; persistence is best-effort.
  }
}

function readAll(storage: JobStorage | undefined | null): StoredJobs {
  const raw = readRaw(storage, STORAGE_KEY);
  if (typeof raw !== 'string' || raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as StoredJobs;
}

function isStoredJob(value: unknown): value is StoredJob {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as StoredJob).id === 'string'
    && typeof (value as StoredJob).status === 'string';
}

export function restoreDurableJob(sessionId: string, storage: JobStorage | undefined | null): StoredJob | undefined {
  if (!sessionId) return undefined;
  const entry = readAll(storage)[sessionId];
  if (!isStoredJob(entry)) return undefined;
  return {id: entry.id, status: entry.status};
}

export function saveDurableJob(sessionId: string, job: StoredJob, storage: JobStorage | undefined | null): void {
  if (!sessionId || !isStoredJob(job)) return;
  const all = readAll(storage);
  all[sessionId] = {id: job.id, status: job.status};
  writeRaw(storage, STORAGE_KEY, JSON.stringify(all));
}

const KNOWN_ARTIFACT_KINDS = new Set(['image', 'video', 'document']);

// Maps the loosely-typed `result` from a durable job status response into safe
// artifact panel entries. Defensive by design: `result` comes from the network
// and must never crash the panel or leak an unsafe path into a fetch/URL.
//
// - `path` must be a non-empty relative string without `..` segments (rejects
//   path traversal outright rather than sanitizing it, per the brief).
// - `kind` normalizes to exactly 'image' | 'video' | 'document'; anything
//   missing/unrecognized falls back to 'document' (the safest default: it never
//   renders an <img>/<video> tag, only a name/type/status row).
// - `name` falls back to the path's basename when absent/empty, so the panel
//   never has to render a blank name.
export function artifactsFromJobResult(result: unknown): DurableResultArtifact[] {
  if (!result || typeof result !== 'object') return [];
  const rawArtifacts = (result as {artifacts?: unknown}).artifacts;
  if (!Array.isArray(rawArtifacts)) return [];

  const mapped: DurableResultArtifact[] = [];
  for (const entry of rawArtifacts) {
    if (!entry || typeof entry !== 'object') continue;
    const rawPath = (entry as {path?: unknown}).path;
    if (typeof rawPath !== 'string') continue;
    const path = rawPath.trim();
    if (!path || path.includes('..') || path.startsWith('/')) continue;

    const rawName = (entry as {name?: unknown}).name;
    const name = typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : basename(path);

    const rawKind = (entry as {kind?: unknown}).kind;
    const kind = KNOWN_ARTIFACT_KINDS.has(rawKind as string) ? (rawKind as DurableResultArtifact['kind']) : 'document';

    mapped.push({path, name, kind});
  }
  return mapped;
}

function basename(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] || path;
}
