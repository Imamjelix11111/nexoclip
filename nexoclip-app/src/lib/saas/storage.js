const KEY = 'nexoclip_workspace_id';
function storage() { return typeof window === 'undefined' ? null : window.sessionStorage; }
export function getStoredWorkspaceId() { const value = storage()?.getItem(KEY); return value && /^[a-zA-Z0-9_-]+$/.test(value) ? value : null; }
export function setStoredWorkspaceId(id) { if (typeof id === 'string' && id) storage()?.setItem(KEY, id); }
export function clearStoredWorkspaceId() { storage()?.removeItem(KEY); }
