// Pure, DOM-free. Persists which jobs to reattach to after a refresh; the server
// remains the source of truth for a job's actual status/result.
const KEY = 'nexoclip-active-jobs';

function read(storage) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function write(storage, data) {
  try {
    storage?.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — best effort */
  }
}

export function rememberActiveJob(workspaceId, jobId, storage) {
  const data = read(storage);
  const list = Array.isArray(data[workspaceId]) ? data[workspaceId] : [];
  if (!list.includes(jobId)) list.push(jobId);
  data[workspaceId] = list;
  write(storage, data);
}

export function forgetActiveJob(workspaceId, jobId, storage) {
  const data = read(storage);
  const list = Array.isArray(data[workspaceId]) ? data[workspaceId] : [];
  data[workspaceId] = list.filter((id) => id !== jobId);
  write(storage, data);
}

export function restoreActiveJobs(workspaceId, storage) {
  const list = read(storage)[workspaceId];
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
}
