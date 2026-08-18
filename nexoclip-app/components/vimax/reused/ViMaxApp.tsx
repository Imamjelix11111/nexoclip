'use client';

import {useCallback, useEffect, useState} from 'react';
import {createVimaxSession, getVimaxJob, getVimaxSessions, submitVimaxJob} from './api';
import {restoreDurableJob, saveDurableJob} from './vimaxWorkspaceState';
import type {DurableSessionSummary} from './types';

// Kept during the durable storyboard migration: interactive chat/uploads and other
// legacy agent-bridge controls are intentionally not wired to any backend.
const UNAVAILABLE_MESSAGE =
  'Interactive chat and uploads are temporarily unavailable while durable storyboard migration is in progress.';

const TERMINAL_STATUSES = ['succeeded', 'failed', 'canceled'];

type DurableJob = {
  id: string;
  status: string;
  progress?: {stage?: string; message?: string};
  result?: Record<string, unknown>;
};

type WorkspaceView = 'workspace' | 'artifacts';

function jobStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export default function ViMaxApp() {
  const [sessions, setSessions] = useState<DurableSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [job, setJob] = useState<DurableJob>();
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('workspace');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectError, setNewProjectError] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [loadError, setLoadError] = useState('');

  const selectedSession = sessions.find((session) => session.sessionId === selectedSessionId);
  const active = Boolean(job && !TERMINAL_STATUSES.includes(job.status));

  const refreshSessions = useCallback(async () => {
    const state = await getVimaxSessions();
    setSessions(state.sessions);
    return state.sessions;
  }, []);

  // Load the durable project catalog once. Read-only: it never starts a render.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await refreshSessions();
        if (cancelled || list.length === 0) return;
        setSelectedSessionId((current) => current || list[0].sessionId);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSessions]);

  // Rehydrate the persisted job for whichever session is selected. Selecting a
  // project only reads persisted state; it never restarts an in-flight render.
  useEffect(() => {
    if (!selectedSessionId) {
      setJob(undefined);
      return;
    }
    const restored = restoreDurableJob(selectedSessionId, jobStorage());
    setJob(restored ? {id: restored.id, status: restored.status} : undefined);
  }, [selectedSessionId]);

  // Authoritative status polling against the durable generation record.
  useEffect(() => {
    if (!job?.id || !selectedSessionId || TERMINAL_STATUSES.includes(job.status)) return;
    const sessionId = selectedSessionId;
    const jobId = job.id;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await getVimaxJob(jobId);
        if (cancelled) return;
        const next = response.generation as DurableJob;
        setJob(next);
        saveDurableJob(sessionId, {id: next.id, status: next.status}, jobStorage());
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status, selectedSessionId]);

  function selectSession(sessionId: string) {
    setLoadError('');
    setSelectedSessionId(sessionId);
    setMobileSidebarOpen(false);
    setWorkspaceView('workspace');
  }

  function openNewProjectDialog() {
    setNewProjectName('');
    setNewProjectError('');
    setNewProjectOpen(true);
  }

  async function createProject() {
    const projectName = newProjectName.trim();
    if (creatingProject) return;
    setCreatingProject(true);
    setNewProjectError('');
    setLoadError('');
    try {
      const created = await createVimaxSession(projectName);
      await refreshSessions();
      setSelectedSessionId(created.session_id);
      setWorkspaceView('workspace');
      setNewProjectOpen(false);
      setNewProjectName('');
      setMobileSidebarOpen(false);
    } catch (error) {
      setNewProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingProject(false);
    }
  }

  async function render() {
    if (!selectedSessionId || active) return;
    setLoadError('');
    try {
      const created = await submitVimaxJob({
        kind: 'vimax_render_video',
        sessionId: selectedSessionId,
        input: {},
        idempotencyKey: crypto.randomUUID(),
      });
      const next: DurableJob = {id: created.id, status: created.status};
      setJob(next);
      saveDurableJob(selectedSessionId, {id: next.id, status: next.status}, jobStorage());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        open={sidebarOpen}
        mobileOpen={mobileSidebarOpen}
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        activeView={workspaceView}
        onToggle={() => setSidebarOpen((value) => !value)}
        onMobileClose={() => setMobileSidebarOpen(false)}
        onNew={openNewProjectDialog}
        onSelect={selectSession}
        onWorkspace={() => {
          setWorkspaceView('workspace');
          setMobileSidebarOpen(false);
        }}
        onArtifacts={() => {
          setWorkspaceView('artifacts');
          setMobileSidebarOpen(false);
        }}
      />

      <main className="workspace-main">
        <div className="workspace-utility-bar">
          <button className="icon-button mobile-only" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation">☰</button>
          {!sidebarOpen && (
            <button className="icon-button desktop-only" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">▸</button>
          )}
          <span className="workspace-utility-spacer" />
          <strong className="workspace-utility-title">{workspaceView === 'artifacts' ? 'Artifacts' : projectTitle(selectedSession)}</strong>
        </div>

        <div className="conversation">
          {loadError && (
            <div className="inline-error" role="alert">
              <span>{loadError}</span>
              <button onClick={() => setLoadError('')} aria-label="Dismiss error">✕</button>
            </div>
          )}
          {workspaceView === 'artifacts' ? (
            <section className="empty-state">
              <h1>Artifacts</h1>
              <p>{UNAVAILABLE_MESSAGE}</p>
            </section>
          ) : !selectedSessionId ? (
            <EmptyState onNew={openNewProjectDialog} />
          ) : (
            <StagePanel session={selectedSession} job={job} />
          )}
        </div>

        {workspaceView === 'workspace' && (
          <div className="composer-zone">
            <p className="composer-note" role="note">{UNAVAILABLE_MESSAGE}</p>
            <div className="composer">
              <textarea
                placeholder="Describe what you want to make"
                aria-label="Message AI Storyboard"
                rows={1}
                disabled
                title={UNAVAILABLE_MESSAGE}
              />
              <div className="composer-controls">
                <button type="button" className="composer-add" disabled title={UNAVAILABLE_MESSAGE} aria-label="Upload files (unavailable)">＋</button>
                <span className="model-picker-trigger is-disabled" aria-disabled="true" title={UNAVAILABLE_MESSAGE}>
                  <span className="model-picker-mark">✦</span>
                  <span className="model-picker-label">Storyboard model</span>
                </span>
                <div className="composer-spacer" />
                <button
                  type="button"
                  className="send-button"
                  onClick={() => void render()}
                  disabled={!selectedSessionId || active}
                  aria-label="Render video"
                >
                  <span>{active ? 'Rendering…' : 'Render video'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <NewProjectDialog
        open={newProjectOpen}
        name={newProjectName}
        error={newProjectError}
        creating={creatingProject}
        onNameChange={(value) => {
          setNewProjectName(value);
          setNewProjectError('');
        }}
        onCancel={() => {
          if (creatingProject) return;
          setNewProjectOpen(false);
          setNewProjectError('');
        }}
        onConfirm={() => void createProject()}
      />
    </div>
  );
}

function Sidebar({open, mobileOpen, sessions, selectedSessionId, activeView, onToggle, onMobileClose, onNew, onSelect, onWorkspace, onArtifacts}: {
  open: boolean;
  mobileOpen: boolean;
  sessions: DurableSessionSummary[];
  selectedSessionId: string;
  activeView: WorkspaceView;
  onToggle: () => void;
  onMobileClose: () => void;
  onNew: () => void;
  onSelect: (sessionId: string) => void;
  onWorkspace: () => void;
  onArtifacts: () => void;
}) {
  return (
    <>
      {mobileOpen && <button className="sidebar-scrim" onClick={onMobileClose} aria-label="Close navigation" />}
      <aside className={`sidebar ${open ? 'is-open' : 'is-collapsed'} ${mobileOpen ? 'is-mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <strong>AI Storyboard</strong>
          <button className="icon-button sidebar-collapse desktop-only" onClick={onToggle} aria-label="Collapse navigation">◂</button>
          <button className="icon-button mobile-only" onClick={onMobileClose} aria-label="Close navigation">✕</button>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <button onClick={onNew}><span>＋ New project</span></button>
          <button className={activeView === 'workspace' ? 'is-active' : ''} onClick={onWorkspace}><span>Workspace</span></button>
          <button className={activeView === 'artifacts' ? 'is-active' : ''} onClick={onArtifacts}><span>Artifacts</span></button>
        </nav>
        <div className="session-section">
          <div className="section-label"><span>Projects</span><span>{sessions.length}</span></div>
          <div className="session-list">
            {sessions.map((session) => (
              <div key={session.sessionId} className={`session-item ${session.sessionId === selectedSessionId ? 'is-selected' : ''}`}>
                <button className="session-open" onClick={() => onSelect(session.sessionId)}>
                  <span className="session-copy">
                    <strong>{sessionTitle(session)}</strong>
                    <small>{relativeTime(session.updatedAt)} · {stageLabel(session.stage)}</small>
                  </span>
                </button>
              </div>
            ))}
            {sessions.length === 0 && <span className="empty-list">No projects yet</span>}
          </div>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">V</span>
          <div><strong>Workspace</strong><small>AI Storyboard</small></div>
        </div>
      </aside>
    </>
  );
}

function EmptyState({onNew}: {onNew: () => void}) {
  return (
    <section className="empty-state">
      <img className="empty-state-logo" src="/vimax-light.svg" alt="AI Storyboard" />
      <h1>What should we create?</h1>
      <p>Create a durable storyboard project to begin.</p>
      <button className="send-button" type="button" onClick={onNew}><span>New project</span></button>
    </section>
  );
}

function StagePanel({session, job}: {session?: DurableSessionSummary; job?: DurableJob}) {
  const statusLabel = job ? renderStatusLabel(job.status) : 'No render yet';
  return (
    <section className="storyboard-stage">
      <header className="storyboard-stage-header">
        <strong>{projectTitle(session)}</strong>
        <span className={`stage-status status-${job?.status || 'idle'}`}>{statusLabel}</span>
      </header>
      {job ? (
        <div className="stage-body">
          <p className="stage-line"><span>Job</span><code>{job.id}</code></p>
          {job.progress?.stage && <p className="stage-line"><span>Stage</span><span>{humanize(job.progress.stage)}</span></p>}
          {job.progress?.message && <p className="stage-line"><span>Progress</span><span>{job.progress.message}</span></p>}
          {job.result && (
            <details className="stage-result" open>
              <summary>Result</summary>
              <pre>{JSON.stringify(job.result, null, 2)}</pre>
            </details>
          )}
        </div>
      ) : (
        <p className="stage-empty">Use “Render video” below to submit a durable render for this project.</p>
      )}
    </section>
  );
}

function NewProjectDialog({open, name, error, creating, onNameChange, onCancel, onConfirm}: {
  open: boolean;
  name: string;
  error: string;
  creating: boolean;
  onNameChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creating) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [creating, onCancel, open]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <form
        className="project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <div className="dialog-copy">
          <h2 id="new-project-title">Create a new project</h2>
          <p>Name the workspace before creating it.</p>
        </div>
        <label className="project-name-field">
          <span>Project name</span>
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Untitled video"
            maxLength={64}
            autoFocus
            disabled={creating}
          />
          {error && <small role="alert">{error}</small>}
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={creating}>Cancel</button>
          <button type="submit" className="primary" disabled={creating}>{creating ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </div>
  );
}

function projectTitle(session?: DurableSessionSummary) {
  return sessionTitle(session);
}

function sessionTitle(session?: DurableSessionSummary) {
  if (!session) return 'New video';
  if (session.projectName) return session.projectName;
  if (session.summary) return session.summary.length > 38 ? `${session.summary.slice(0, 38).trim()}…` : session.summary;
  return session.sessionId.replace(/^\d{8}-\d{6}-?/, '') || 'Untitled video';
}

function renderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: 'Queued',
    running: 'Running',
    succeeded: 'Succeeded',
    failed: 'Failed',
    canceled: 'Canceled',
    loading: 'Loading…',
  };
  return labels[status] || humanize(status || 'idle');
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    created: 'Created',
    narrative_planning: 'Planning',
    narrative_planned: 'Plan ready',
    novel_planning: 'Planning novel',
    novel_planned: 'Novel ready',
    rendering: 'Rendering',
    rendered: 'Rendered',
    error: 'Needs attention',
  };
  return labels[stage] || humanize(stage || 'Created');
}

function humanize(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

function relativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Recently';
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
