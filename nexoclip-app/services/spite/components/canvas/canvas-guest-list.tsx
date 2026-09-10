'use client'

import type { RemotePresencePeer } from '@/lib/realtime/presence'

type CanvasGuestListProps = {
  peers: RemotePresencePeer[]
  onFollow: (peer: RemotePresencePeer) => void
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'
}

export function CanvasGuestList({ peers, onFollow }: CanvasGuestListProps) {
  if (peers.length === 0) return null

  return (
    <div className="flex items-center -space-x-1.5" aria-label="Online collaborators">
      {peers.map((peer) => (
        <button
          key={peer.clientId}
          type="button"
          onClick={() => onFollow(peer)}
          title={`Follow ${peer.name}`}
          aria-label={`Follow ${peer.name}`}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#0D0F12] text-[10px] font-semibold text-white shadow-sm transition-transform hover:z-10 hover:scale-110 focus:z-10 focus:outline-none focus:ring-2 focus:ring-accent"
          style={{ backgroundColor: peer.color.cursor }}
        >
          {initials(peer.name)}
        </button>
      ))}
    </div>
  )
}
