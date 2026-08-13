'use client';

import './reused/styles.css';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import AccountMenu from '../AccountMenu';

const ViMaxApp = dynamic(() => import('./reused/ViMaxApp'), {ssr: false, loading: () => <div className="flex h-full items-center justify-center text-sm text-white/45">Loading AI Storyboard…</div>});

export default function ViMaxStudioPage() {
  return (
    <main className="min-h-screen bg-[#080809] text-white">
      <header className="flex h-14 items-center justify-between border-b border-white/[0.08] bg-[#0d0d0f] px-4 md:px-6">
        <Link href="/studio" className="text-sm font-medium text-white/70 transition hover:text-white">
          ← Back to Studio
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-white/35 sm:inline">Nexoclip</span>
          <AccountMenu />
        </div>
      </header>
      <div className="h-[calc(100vh-3.5rem)]">
        <ViMaxApp />
      </div>
    </main>
  );
}
