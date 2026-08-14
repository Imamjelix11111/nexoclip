'use client';

import {useEffect, useState} from 'react';
import {getVimaxJob, submitVimaxJob} from './api';

type DurableJob = {id: string; status: string; progress?: {stage?: string; message?: string}; result?: Record<string, unknown>};
const STORAGE_KEY = 'vimax-durable-job';

export default function ViMaxApp() {
  const [sessionId, setSessionId] = useState('');
  const [job, setJob] = useState<DurableJob>();
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const value = JSON.parse(saved);
      if (typeof value.sessionId === 'string') setSessionId(value.sessionId);
      if (typeof value.jobId === 'string') setJob({id: value.jobId, status: 'loading'});
    } catch { window.localStorage.removeItem(STORAGE_KEY); }
  }, []);

  useEffect(() => {
    if (!job?.id || ['succeeded', 'failed', 'canceled'].includes(job.status)) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await getVimaxJob(job.id);
        if (!cancelled) setJob(response.generation);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to refresh job');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [job?.id, job?.status]);

  async function render() {
    const normalizedSession = sessionId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(normalizedSession)) {
      setError('Enter a valid storyboard session ID.');
      return;
    }
    setError('');
    try {
      const created = await submitVimaxJob({
        kind: 'vimax_render_video', sessionId: normalizedSession, input: {}, idempotencyKey: crypto.randomUUID(),
      });
      const next = {id: created.id, status: created.status};
      setJob(next);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({sessionId: normalizedSession, jobId: created.id}));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to submit render'); }
  }

  const active = job && !['succeeded', 'failed', 'canceled'].includes(job.status);
  return <main className="app-shell"><section className="empty-state">
    <img className="empty-state-logo" src="/vimax-light.svg" alt="AI Storyboard" />
    <h1>Durable storyboard render</h1>
    <p>Project browsing, history, artifacts, uploads, and chat are unavailable during the durable-job migration.</p>
    <label className="project-name-field"><span>Storyboard session ID</span>
      <input value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="session-identifier" maxLength={96} />
    </label>
    <button className="send-button" type="button" onClick={() => void render()} disabled={Boolean(active)}>
      {active ? 'Rendering…' : 'Render video'}
    </button>
    {job && <p role="status">Job {job.id}: {job.status}{job.progress?.stage ? ` · ${job.progress.stage}` : ''}{job.progress?.message ? ` — ${job.progress.message}` : ''}</p>}
    {job?.result && <pre>{JSON.stringify(job.result, null, 2)}</pre>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section></main>;
}
