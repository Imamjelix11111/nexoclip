'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { saasFetch } from '../../src/lib/saas/api.js';
import {
  clearStoredWorkspaceId,
  getStoredWorkspaceId,
  setStoredWorkspaceId,
} from '../../src/lib/saas/storage.js';

const EMPTY_STATE = {
  status: 'unauthenticated',
  user: null,
  workspaces: [],
  workspaceId: null,
  workspace: null,
  error: null,
};

export function resetSaaSSession() {
  return { ...EMPTY_STATE };
}

function safeError(error) {
  if (error?.status === 401 || error?.code === 'UNAUTHENTICATED') return null;
  return typeof error?.message === 'string' && error.message.length <= 200
    ? error.message
    : 'Unable to load your NexoClip session.';
}

export async function loadSaaSSession({
  fetcher = saasFetch,
  getStoredId = getStoredWorkspaceId,
} = {}) {
  try {
    const session = await fetcher('/api/auth/session');
    if (!session?.authenticated) return resetSaaSSession();

    const workspaceResponse = await fetcher('/api/workspaces');
    const workspaces = Array.isArray(workspaceResponse?.workspaces)
      ? workspaceResponse.workspaces
      : [];
    const storedId = getStoredId();
    const workspace = workspaces.find(({ id }) => id === storedId) || workspaces[0] || null;

    if (workspace) setStoredWorkspaceId(workspace.id);
    else clearStoredWorkspaceId();

    return {
      status: 'authenticated',
      user: session.user || null,
      workspaces,
      workspaceId: workspace?.id || null,
      workspace,
      error: null,
    };
  } catch (error) {
    if (error?.status === 401) return resetSaaSSession();
    return { ...resetSaaSSession(), status: 'error', error: safeError(error) };
  }
}

export function selectWorkspace(state, id) {
  const workspace = state.workspaces.find((candidate) => candidate.id === id);
  if (!workspace) return state;
  setStoredWorkspaceId(workspace.id);
  return { ...state, workspaceId: workspace.id, workspace };
}

export async function logoutSaaSSession({ fetcher = saasFetch } = {}) {
  try {
    await fetcher('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    // Clear local session state even when the server cannot be reached.
  } finally {
    clearStoredWorkspaceId();
  }
  return resetSaaSSession();
}

export const SaaSContext = createContext(null);

export function SaaSProvider({ children }) {
  const [state, setState] = useState({ ...EMPTY_STATE, status: 'loading' });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: null }));
    setState(await loadSaaSSession());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const select = useCallback((id) => {
    setState((current) => selectWorkspace(current, id));
  }, []);

  const logout = useCallback(async () => {
    const next = await logoutSaaSSession();
    setState(next);
  }, []);

  const value = useMemo(() => ({ ...state, selectWorkspace: select, refresh, logout }), [state, select, refresh, logout]);
  return React.createElement(SaaSContext.Provider, { value }, children);
}

export function useSaaS() {
  const context = useContext(SaaSContext);
  if (!context) throw new Error('useSaaS must be used within SaaSProvider');
  return context;
}
