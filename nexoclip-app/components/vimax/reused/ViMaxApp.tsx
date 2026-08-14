import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowUp,
  Brain,
  Braces,
  CircleStop,
  Clock3,
  FilePenLine,
  FileText,
  Film,
  Folder,
  FolderPlus,
  Files,
  Image as ImageIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Plus,
  Search,
  ListChecks,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {deleteSession, getArtifacts, getHistory, getModelSelections, getSessions, saveModelSelections, sendMessage, startAgent, stopAgent, subscribeToEvents, uploadWorkspaceFile} from './api';
import {ArtifactsView, StoryboardPanel} from './ArtifactViews';
import {applyAgentEvent, appendLocalUser, composeAgentPrompt, createChatState, humanize} from './events';
import {matchingSlashCommands, shouldShowSlashCommands, type SlashCommandMatch} from './slashCommands';
import {applyTheme} from './theme';
import type {AgentEvent, Artifact, ChatState, Message, ModelSelections, SessionSummary, WorkspaceUpload} from './types';

const CONTEXT_TARGET = 160_000;

type WorkspaceView = 'workspace' | 'artifacts';

export default function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [chat, setChat] = useState<ChatState>(() => createChatState());
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('workspace');
  const [agentReady, setAgentReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [storyboardPanelOpen, setStoryboardPanelOpen] = useState(false);
  const [storyboardCount, setStoryboardCount] = useState(0);
  const [draft, setDraft] = useState('');
  const [modelSelections, setModelSelections] = useState<ModelSelections>();
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [workspaceUploads, setWorkspaceUploads] = useState<WorkspaceUpload[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectError, setNewProjectError] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SessionSummary>();
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedSession = sessions.find((session) => session.sessionId === selectedSessionId);
  const slashMatches = useMemo(() => matchingSlashCommands(draft), [draft]);
  const showSlashCommands = shouldShowSlashCommands(draft, chat.busy);
  const runningRender = useMemo(
    () => [...chat.messages].reverse().find((message) => message.role === 'activity'
      && message.status === 'running'
      && (message.tool || '').toLowerCase().includes('render_video')),
    [chat.messages],
  );

  useEffect(() => {
    applyTheme('dark');
  }, []);

  const refreshSessions = useCallback(async () => {
    const state = await getSessions();
    setSessions(state.sessions);
    return state;
  }, []);

  const refreshArtifacts = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      setArtifacts([]);
      return;
    }
    const payload = await getArtifacts(sessionId);
    setArtifacts(payload.artifacts);
  }, []);

  useEffect(() => subscribeToEvents((event) => {
    if (event.type === 'sessions_changed') {
      setSessions(event.sessions || []);
      if (event.activeSessionId) setSelectedSessionId(event.activeSessionId);
      return;
    }
    if (event.type === 'bridge_status') {
      if (event.status === 'ready' || event.status === 'starting') setAgentReady(true);
      if (event.status === 'stopped' || event.status === 'error') setAgentReady(false);
    }
    if (event.type === 'session') {
      const sessionId = event.session?.active_session_id || event.session?.session?.session_id || '';
      if (sessionId) {
        setSelectedSessionId(sessionId);
        void refreshSessions();
        void refreshArtifacts(sessionId);
      }
    }
    setChat((current) => applyAgentEvent(current, event));
  }, () => undefined), [refreshArtifacts, refreshSessions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [state, models] = await Promise.all([refreshSessions(), getModelSelections()]);
        setModelSelections(models);
        if (cancelled || !state.activeSessionId) return;
        setSelectedSessionId(state.activeSessionId);
        const [history] = await Promise.all([
          getHistory(state.activeSessionId),
          refreshArtifacts(state.activeSessionId),
        ]);
        if (!cancelled) setChat(createChatState(history.messages));
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshArtifacts, refreshSessions]);

  useEffect(() => {
    if (!runningRender || !selectedSessionId) return;
    void refreshArtifacts(selectedSessionId);
    const interval = window.setInterval(() => void refreshArtifacts(selectedSessionId), 2_000);
    return () => {
      window.clearInterval(interval);
      void refreshArtifacts(selectedSessionId);
    };
  }, [refreshArtifacts, runningRender, selectedSessionId]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({top: element.scrollHeight, behavior: chat.busy ? 'smooth' : 'auto'});
  }, [chat.messages, chat.busy]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = window.innerWidth < 768 ? 150 : 250;
    textarea.style.height = `${Math.min(maxHeight, Math.max(40, textarea.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    setWorkspaceUploads([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [selectedSessionId]);

  async function openSession(sessionId: string) {
    if (!sessionId || sessionId === selectedSessionId) {
      setMobileSidebarOpen(false);
      return;
    }
    setLoadError('');
    setSelectedSessionId(sessionId);
    setMobileSidebarOpen(false);
    setChat(createChatState());
    try {
      const [history] = await Promise.all([
        getHistory(sessionId),
        refreshArtifacts(sessionId),
      ]);
      setChat(createChatState(history.messages));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }

  function openNewProjectDialog() {
    setNewProjectName('');
    setNewProjectError('');
    setNewProjectOpen(true);
  }

  async function newProject() {
    const projectName = newProjectName.trim();
    if (!projectName || creatingProject) return;
    setCreatingProject(true);
    setNewProjectError('');
    setLoadError('');
    setMobileSidebarOpen(false);
    try {
      await startAgent({newSession: true, projectName});
      setAgentReady(true);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      const state = await refreshSessions();
      setSelectedSessionId(state.activeSessionId);
      setChat(createChatState());
      setArtifacts([]);
      setWorkspaceView('workspace');
      setNewProjectOpen(false);
      setNewProjectName('');
      textareaRef.current?.focus();
    } catch (error) {
      setNewProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingProject(false);
    }
  }

  async function submit() {
    const text = draft.trim();
    if (!text || chat.busy || uploadingFiles) return;
    setLoadError('');
    setDraft('');
    setChat((current) => appendLocalUser(current, text));
    try {
      if (!agentReady) {
        await startAgent(selectedSessionId ? {sessionId: selectedSessionId} : {newSession: true});
        setAgentReady(true);
      }
      const outbound = composeAgentPrompt(text, workspaceUploads.map((file) => file.path));
      await sendMessage(outbound);
      setWorkspaceUploads([]);
    } catch (error) {
      const event: AgentEvent = {type: 'error', message: error instanceof Error ? error.message : String(error)};
      setChat((current) => applyAgentEvent(current, event));
    }
  }

  async function uploadFiles(files: FileList | null) {
    const sessionId = selectedSessionId;
    if (!files?.length) return;
    if (!sessionId) {
      setLoadError('Create or select a project before uploading files');
      return;
    }
    setUploadingFiles(true);
    setLoadError('');
    let uploadedAny = false;
    try {
      for (const file of Array.from(files)) {
        const result = await uploadWorkspaceFile(sessionId, file);
        uploadedAny = true;
        setWorkspaceUploads((current) => [
          ...current.filter((item) => item.path !== result.file.path),
          result.file,
        ]);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (uploadedAny) await refreshArtifacts(sessionId);
      setUploadingFiles(false);
      textareaRef.current?.focus();
    }
  }

  async function stop() {
    await stopAgent();
    setAgentReady(false);
    setChat((current) => ({...current, busy: false}));
  }

  async function selectModel(group: 'llm' | 'image', model: string) {
    if (!modelSelections || modelSelections.models[group] === model) {
      setModelMenuOpen(false);
      return;
    }
    try {
      const next = await saveModelSelections({...modelSelections.models, [group]: model});
      setModelSelections(next);
      setModelMenuOpen(false);
      setAgentReady(false);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    const sessionId = pendingDelete.sessionId;
    const deletingSelected = sessionId === selectedSessionId;
    setDeleting(true);
    setLoadError('');
    try {
      const state = await deleteSession(sessionId);
      setSessions(state.sessions);
      setPendingDelete(undefined);
      if (deletingSelected) {
        setSelectedSessionId('');
        setChat(createChatState());
        setArtifacts([]);
        setAgentReady(false);
        if (state.activeSessionId) await openSession(state.activeSessionId);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  }

  const contextPercent = Math.min(100, Math.round((chat.promptTokens / CONTEXT_TARGET) * 100));
  const hasConversation = chat.messages.length > 0;

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
        onSelect={(sessionId) => void openSession(sessionId)}
        onWorkspace={() => {
          setWorkspaceView('workspace');
          setMobileSidebarOpen(false);
        }}
        onArtifacts={() => {
          setWorkspaceView('artifacts');
          setMobileSidebarOpen(false);
        }}
        onDelete={setPendingDelete}
      />

      <main className="workspace-main">
        {workspaceView === 'workspace' ? (
          <div className="workspace-utility-bar">
            <button className="icon-button mobile-only" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation">
              <Menu size={19} />
            </button>
            {!sidebarOpen && (
              <button className="icon-button desktop-only" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
                <PanelLeftOpen size={18} />
              </button>
            )}
            <span className="workspace-utility-spacer" />
            <div className="workspace-utility-actions">
              <button className="icon-button artifact-toggle" onClick={() => setStoryboardPanelOpen((value) => !value)} aria-label="Toggle storyboard preview">
                <PanelRight size={18} />
                {storyboardCount > 0 && <span className="count-badge">{storyboardCount}</span>}
              </button>
            </div>
          </div>
        ) : (
          <header className="workspace-header">
            <div className="workspace-title-row">
              <button className="icon-button mobile-only" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation">
                <Menu size={19} />
              </button>
              {!sidebarOpen && (
                <button className="icon-button desktop-only" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">
                  <PanelLeftOpen size={18} />
                </button>
              )}
              <div className="workspace-title-copy"><strong>Artifacts</strong></div>
            </div>
          </header>
        )}

        {workspaceView === 'workspace' ? (
          <div className="conversation" ref={scrollRef}>
            {!hasConversation ? (
              <EmptyState />
            ) : (
              <div className="message-stream">
                {chat.messages.map((message) => <MessageRow key={message.id} message={message} />)}
                {chat.busy && <ThinkingRow messages={chat.messages} />}
              </div>
            )}
          </div>
        ) : (
          <ArtifactsView session={selectedSession} artifacts={artifacts} />
        )}

        {workspaceView === 'workspace' && <div className="composer-zone">
          {loadError && (
            <div className="inline-error" role="alert">
              <span>{loadError}</span>
              <button onClick={() => setLoadError('')} aria-label="Dismiss error"><X size={15} /></button>
            </div>
          )}
          {showSlashCommands && <SlashCommandMenu matches={slashMatches} contextPercent={contextPercent} onSelect={(command) => {
            setDraft(command);
            textareaRef.current?.focus();
          }} />}
          <div className={`composer ${chat.busy ? 'is-busy' : ''}`}>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Tab' && slashMatches[0]) {
                  event.preventDefault();
                  setDraft(slashMatches[0].name);
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="Describe what you want to make"
              aria-label="Message AI Storyboard"
              disabled={chat.busy}
              rows={1}
            />
            {(workspaceUploads.length > 0 || uploadingFiles) && (
              <div className="composer-attachments" aria-live="polite">
                {workspaceUploads.map((file) => (
                  <span className="composer-attachment" key={file.path} title={file.path}>
                    <FileText size={13} />
                    <span>{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setWorkspaceUploads((current) => current.filter((item) => item.path !== file.path))}
                      aria-label={`Remove ${file.name} from this message`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {uploadingFiles && <span className="composer-uploading">Uploading…</span>}
              </div>
            )}
            <div className="composer-controls">
              <input
                ref={fileInputRef}
                className="composer-file-input"
                type="file"
                multiple
                onChange={(event) => void uploadFiles(event.currentTarget.files)}
                tabIndex={-1}
              />
              <button
                type="button"
                className="composer-add"
                onClick={() => fileInputRef.current?.click()}
                disabled={!selectedSessionId || uploadingFiles || chat.busy}
                aria-label="Upload files to workspace"
                aria-busy={uploadingFiles}
                title={selectedSessionId ? 'Upload files to workspace' : 'Create or select a project first'}
              >
                <Plus size={20} />
              </button>
              <div className="model-picker">
                <button
                  type="button"
                  className={`model-picker-trigger ${modelMenuOpen ? 'is-active' : ''}`}
                  onClick={() => setModelMenuOpen((open) => !open)}
                  aria-expanded={modelMenuOpen}
                  aria-haspopup="menu"
                >
                  <span className="model-picker-mark">✦</span>
                  <span className="model-picker-label">{modelSelections?.options.llm.find((option) => option.id === modelSelections.models.llm)?.label || 'Agent model'}</span>
                  <svg className="model-picker-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {modelMenuOpen && modelSelections && (
                  <div className="model-picker-menu" role="menu">
                    {(['llm', 'image'] as const).map((group) => (
                      <div key={group} className="model-picker-group">
                        <span>{group === 'llm' ? 'Agent model' : 'Image model'}</span>
                        {modelSelections.options[group].map((option) => (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={modelSelections.models[group] === option.id}
                            key={option.id}
                            onClick={() => void selectModel(group, option.id)}
                          >
                            <span>{option.label}</span><small>{option.id}</small>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="composer-spacer" />
              {chat.busy ? (
                <button className="send-button stop" onClick={() => void stop()} aria-label="Stop generation"><CircleStop size={17} /><span>Stop</span></button>
              ) : (
                <button className="send-button" onClick={() => void submit()} disabled={!draft.trim() || uploadingFiles} aria-label="Send message"><span>Send message</span></button>
              )}
            </div>
          </div>
        </div>}
      </main>

      <StoryboardPanel
        open={storyboardPanelOpen && workspaceView === 'workspace'}
        artifacts={artifacts}
        activeRenderStage={runningRender?.stage}
        onClose={() => setStoryboardPanelOpen(false)}
        onCountChange={setStoryboardCount}
      />
      <DeleteProjectDialog
        session={pendingDelete}
        deleting={deleting}
        onCancel={() => !deleting && setPendingDelete(undefined)}
        onConfirm={() => void confirmDelete()}
      />
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
        onConfirm={() => void newProject()}
      />
    </div>
  );
}

function Sidebar({open, mobileOpen, sessions, selectedSessionId, activeView, onToggle, onMobileClose, onNew, onSelect, onWorkspace, onArtifacts, onDelete}: {
  open: boolean;
  mobileOpen: boolean;
  sessions: SessionSummary[];
  selectedSessionId: string;
  activeView: WorkspaceView;
  onToggle: () => void;
  onMobileClose: () => void;
  onNew: () => void;
  onSelect: (sessionId: string) => void;
  onWorkspace: () => void;
  onArtifacts: () => void;
  onDelete: (session: SessionSummary) => void;
}) {
  return (
    <>
      {mobileOpen && <button className="sidebar-scrim" onClick={onMobileClose} aria-label="Close navigation" />}
      <aside className={`sidebar ${open ? 'is-open' : 'is-collapsed'} ${mobileOpen ? 'is-mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <strong>AI Storyboard</strong>
          <button className="icon-button sidebar-collapse desktop-only" onClick={onToggle} aria-label="Collapse navigation">
            <PanelLeftClose size={17} />
          </button>
          <button className="icon-button mobile-only" onClick={onMobileClose} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <button onClick={onNew}><FolderPlus size={17} /><span>New project</span></button>
          <button className={activeView === 'workspace' ? 'is-active' : ''} onClick={onWorkspace}><Folder size={17} /><span>Workspace</span></button>
          <button className={activeView === 'artifacts' ? 'is-active' : ''} onClick={onArtifacts}><Files size={17} /><span>Artifacts</span></button>
        </nav>
        <div className="session-section">
          <div className="section-label"><span>Projects</span><span>{sessions.length}</span></div>
          <div className="session-list">
            {sessions.map((session) => (
              <div
                key={session.sessionId}
                className={`session-item ${session.sessionId === selectedSessionId ? 'is-selected' : ''}`}
              >
                <button className="session-open" onClick={() => onSelect(session.sessionId)}>
                  <span className="session-copy">
                    <strong>{sessionTitle(session)}</strong>
                    <small>{relativeTime(session.updatedAt)} · {stageLabel(session.stage)}</small>
                  </span>
                </button>
                <button className="session-delete" onClick={() => onDelete(session)} aria-label={`Delete ${sessionTitle(session)}`} title="Delete project">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {sessions.length === 0 && <span className="empty-list">No projects yet</span>}
          </div>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">V</span>
          <div><strong>Local workspace</strong><small>Local · AI Storyboard</small></div>
        </div>
      </aside>
    </>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <img className="empty-state-logo" src="/vimax-light.svg" alt="AI Storyboard" />
      <h1>What should we create?</h1>
    </section>
  );
}

function MessageRow({message}: {message: Message}) {
  if (message.role === 'activity') return <ActivityRow message={message} />;
  return (
    <article className={`message-row role-${message.role}`}>
      <div className="message-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{a: (props) => <a {...props} target="_blank" rel="noreferrer" />}}>
          {message.text}
        </ReactMarkdown>
      </div>
    </article>
  );
}

function ActivityRow({message}: {message: Message}) {
  const stage = message.stage ? humanize(message.stage) : '';
  const detail = stage.toLowerCase() === message.text.toLowerCase() ? message.text : [stage, message.text].filter(Boolean).join(' · ');
  const toolKind = activityToolKind(message.tool);
  return (
    <div className={`activity-row status-${message.status || 'done'}`}>
      <span className={`activity-indicator tool-${toolKind}`}><ActivityToolIcon tool={message.tool} /></span>
      <div>
        <strong>{humanize(message.tool || 'Workflow')}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function ActivityToolIcon({tool}: {tool?: string}) {
  const name = (tool || '').toLowerCase();
  const props = {size: 13, strokeWidth: 1.8};
  if (name.includes('narrative_planning') || name.includes('novel_planning')) return <FilePenLine {...props} />;
  if (name.includes('render_video')) return <Film {...props} />;
  if (name === 'view_image' || name.includes('image')) return <ImageIcon {...props} />;
  if (name === 'read_json' || name === 'write_json') return <Braces {...props} />;
  if (name === 'read_file' || name === 'write_file') return <FileText {...props} />;
  if (name === 'list_files' || name === 'glob_files') return <Folder {...props} />;
  if (name === 'search_text') return <Search {...props} />;
  if (name.startsWith('memory_')) return <Brain {...props} />;
  if (name.startsWith('todo_')) return <ListChecks {...props} />;
  if (name === 'run_shell') return <Terminal {...props} />;
  if (name === 'sleep') return <Clock3 {...props} />;
  return <Wrench {...props} />;
}

function activityToolKind(tool?: string) {
  const name = (tool || '').toLowerCase();
  if (name.includes('narrative_planning') || name.includes('novel_planning')) return 'planning';
  if (name.includes('render_video')) return 'render';
  if (name === 'view_image' || name.includes('image')) return 'image';
  if (name.startsWith('memory_')) return 'memory';
  if (name.startsWith('todo_')) return 'todo';
  if (name === 'run_shell') return 'shell';
  if (name === 'sleep') return 'time';
  return 'file';
}

function ThinkingRow({messages}: {messages: Message[]}) {
  const running = [...messages].reverse().find((message) => message.role === 'activity' && message.status === 'running');
  return (
    <div className="thinking-row">
      <span className="thinking-mark"><i /><i /><i /></span>
      <span>{running ? `${humanize(running.tool || 'AI Storyboard')} · ${running.text}` : 'AI Storyboard is thinking'}</span>
    </div>
  );
}

function SlashCommandMenu({matches, contextPercent, onSelect}: {matches: SlashCommandMatch[]; contextPercent: number; onSelect: (command: string) => void}) {
  return (
    <div className="slash-command-menu" role="listbox" aria-label="Slash commands">
      {matches.length > 0 ? matches.map((command) => (
        <button key={command.name} role="option" aria-selected="false" onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(command.name)}>
          <code><span><b>{command.matchedPrefix}</b><span>{command.unmatchedSuffix}</span></span>{command.name === '/compact' && <em>{contextPercent}%</em>}</code>
          <small>{command.description}</small>
        </button>
      )) : <span className="slash-command-empty">No matching commands</span>}
    </div>
  );
}

function DeleteProjectDialog({session, deleting, onCancel, onConfirm}: {
  session?: SessionSummary;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!session) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleting, onCancel, session]);

  if (!session) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
        <span className="dialog-icon"><Trash2 size={18} /></span>
        <div className="dialog-copy">
          <h2 id="delete-project-title">Delete project?</h2>
          <p><strong>{sessionTitle(session)}</strong> and its generated files will be permanently removed.</p>
        </div>
        <div className="dialog-actions">
          <button onClick={onCancel} disabled={deleting} autoFocus>Cancel</button>
          <button className="danger" onClick={onConfirm} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
        </div>
      </section>
    </div>
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
      <form className="project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}>
        <span className="dialog-icon is-create"><FolderPlus size={18} /></span>
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
          <button type="submit" className="primary" disabled={creating || !name.trim()}>{creating ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </div>
  );
}

function sessionTitle(session?: SessionSummary) {
  if (!session) return 'New video';
  if (session.projectName) return session.projectName;
  const source = session.idea || session.summary;
  if (source) return source.length > 38 ? `${source.slice(0, 38).trim()}…` : source;
  return session.sessionId.replace(/^\d{8}-\d{6}-?/, '') || 'Untitled video';
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
