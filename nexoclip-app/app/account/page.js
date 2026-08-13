'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'include' });
        const session = await res.json();
        if (!session.authenticated) {
          if (!cancelled) router.replace('/login');
          return;
        }
        if (!cancelled) {
          setUser(session.user || null);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Sign out locally even if the request fails.
    } finally {
      if (typeof window !== 'undefined') window.sessionStorage.removeItem('nexoclip_workspace_id');
      router.replace('/login');
    }
  }, [router]);

  const name = user?.displayName || user?.email || 'Account';
  const initial = (name || '?').trim().charAt(0).toUpperCase();

  return (
    <main className="min-h-screen bg-[#080809] text-white">
      <header className="flex h-14 items-center border-b border-white/[0.08] bg-[#0d0d0f] px-4 md:px-6">
        <Link href="/studio" className="text-sm font-medium text-white/70 transition hover:text-white">
          ← Back to Studio
        </Link>
        <span className="ml-auto text-xs text-white/35">Nexoclip</span>
      </header>

      <div className="mx-auto w-full max-w-lg px-5 py-10">
        <h1 className="mb-6 text-lg font-semibold">Account</h1>

        {status === 'loading' ? (
          <div className="flex items-center gap-3 text-sm text-white/45">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-[#22d3ee]" />
            Loading your account…
          </div>
        ) : (
          <div className="rounded-2xl border border-white/[0.08] bg-[#0d0d0f] p-6">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-full border border-white/[0.08] bg-gradient-to-br from-[#22d3ee]/30 to-purple-500/20 text-xl font-bold text-[#22d3ee]">
                {initial}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{user?.displayName || 'Nexoclip user'}</p>
                {user?.email && <p className="truncate text-sm text-white/45">{user.email}</p>}
              </div>
            </div>

            <dl className="mt-6 space-y-3 border-t border-white/[0.06] pt-5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-white/40">Display name</dt>
                <dd className="truncate text-right text-white/80">{user?.displayName || '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-white/40">Email</dt>
                <dd className="truncate text-right text-white/80">{user?.email || '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-white/40">User ID</dt>
                <dd className="truncate text-right font-mono text-xs text-white/50">{user?.id || '—'}</dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/15 disabled:opacity-50"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {loggingOut ? 'Logging out…' : 'Log out'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
