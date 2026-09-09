'use client'

import type { RemotePresencePeer } from '@/lib/realtime/presence'

type CanvasGuestListProps = {
  peers: RemotePresencePeer[]
  scenes: Array<{ id: string; name: string }>
  onFollow: (peer: RemotePresencePeer) => void
}

export function CanvasGuestList({ peers, scenes, onFollow }: CanvasGuestListProps) {
  if (peers.length === 0) {
    return null
  }

  return (
    <div className="absolute left-3 top-3 z-30 min-w-52 rounded-lg border border-white/10 bg-[#0D0F12]/95 p-2 shadow-lg backdrop-blur-sm">
      <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Guests</div>
      <div className="space-y-1">
        {peers.map((peer) => {
          const sceneName = scenes.find((scene) => scene.id === peer.sceneId)?.name
          const canFollow = scenes.some((scene) => scene.id === peer.sceneId)

          return (
          <div key={peer.clientId} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: peer.color.cursor }} />
            <span className="min-w-0 flex-1 truncate">{peer.name}</span>
            <span className="max-w-24 truncate text-muted-foreground">{sceneName ?? 'No scene'}</span>
            <button
              type="button"
              onClick={() => onFollow(peer)}
              disabled={!canFollow}
              className="rounded bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Follow
            </button>
          </div>
          )
        })}
      </div>
    </div>
  )
}
