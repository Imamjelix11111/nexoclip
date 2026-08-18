// Pure, DOM-free helpers for persisting the durable render job that belongs to a
// storyboard session. Kept free of React/browser globals so refresh behaviour can
// be tested with a plain Map (see tests/components/vimaxWorkspaceState.test.mjs).

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
