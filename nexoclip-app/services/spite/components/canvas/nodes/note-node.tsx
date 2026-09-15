'use client'

import { memo, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { X } from '@phosphor-icons/react'
import { ResizableNodeFrame } from './resizable-node-frame'
import { useCanvasCollaboration } from '../canvas-collaboration'

function NoteNodeImpl({ id, data, selected }: NodeProps) {
  const { deleteNodes, patchNodeData } = useCanvasCollaboration()
  const [text, setText] = useState<string>(typeof data.text === 'string' ? (data.text as string) : '')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Keep local text in sync with authoritative data when not focused
  useEffect(() => {
    const isFocused = document.activeElement === inputRef.current
    if (!isFocused) {
      setText(typeof data.text === 'string' ? (data.text as string) : '')
    }
  }, [data.text])

  return (
    <ResizableNodeFrame
      nodeId={id}
      data={data}
      defaultSize={{ width: 240, height: 160 }}
      bounds={{ minWidth: 160, minHeight: 100, maxWidth: 900, maxHeight: 900 }}
      className="group"
    >
      <div
        className="absolute inset-0 rounded-lg"
        style={{
          background: 'rgba(30,32,38,0.9)',
          border: selected ? '1px solid rgba(107,143,168,0.6)' : '1px solid rgba(255,255,255,0.08)',
          boxShadow: selected ? '0 0 12px rgba(107,143,168,0.25)' : '0 2px 8px rgba(0,0,0,0.35)'
        }}
      />

      {/* Hover delete button (like Sticker/Comment) */}
      <button
        onClick={(e) => { e.stopPropagation(); deleteNodes([id]) }}
        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/80 border border-white/20 text-white/80 hover:text-white hover:bg-red-500/80 hover:border-red-400/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 nodrag"
        aria-label="Delete note"
        title="Delete note"
      >
        <X size={10} weight="bold" />
      </button>

      <textarea
        ref={inputRef}
        aria-label="Note text"
        value={text}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          patchNodeData(id, { text: next })
        }}
        className="nodrag nopan h-full w-full resize-none bg-transparent outline-none p-2 text-[12px] text-foreground/85"
        style={{ position: 'relative' as const, zIndex: 1 }}
        placeholder="Type a note…"
      />
    </ResizableNodeFrame>
  )
}

export const NoteNode = memo(NoteNodeImpl)
NoteNode.displayName = 'NoteNode'
