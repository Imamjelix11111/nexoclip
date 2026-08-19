'use client';

import { useEffect, useState } from 'react';
import { toJobListItem } from '../src/lib/jobs/jobDisplay.js';

// Header panel: polls active jobs while any are running, shows recent on open.
export default function JobListPanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function poll(query) {
      try {
        const res = await fetch(`/api/jobs${query}`, { credentials: 'include' });
        if (!res.ok) return;
        const { jobs } = await res.json();
        if (!cancelled) setItems((jobs || []).map(toJobListItem));
      } catch { /* transient — keep last state */ }
    }
    // When open, show recent (all). Otherwise track only active jobs.
    poll(open ? '' : '?status=active');
    const timer = window.setInterval(() => poll(open ? '' : '?status=active'), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open]);

  const activeCount = items.filter((i) => i.status === 'queued' || i.status === 'running').length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:text-white"
        title="Jobs"
        aria-label="Jobs"
      >
        <span aria-hidden>▤</span>
        {activeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-[#22d3ee] px-1 text-[10px] font-bold text-black">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-auto rounded-xl border border-white/10 bg-[#0d0d0f] p-2 shadow-2xl">
          {items.length === 0 ? (
            <p className="px-2 py-3 text-xs text-white/40">No jobs yet.</p>
          ) : (
            items.map((it) => (
              <div key={it.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                {it.thumbnailUrl ? (
                  <img src={it.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded bg-white/5 text-[10px] text-white/40">
                    {it.kind.slice(0, 3)}
                  </span>
                )}
                <span className="flex-1 truncate text-xs text-white/80">{it.title}</span>
                <span className="text-[10px] uppercase text-white/40">{it.status}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
