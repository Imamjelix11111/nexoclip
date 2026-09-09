'use client'

import { memo, useState, useRef, useEffect } from 'react'
import { NodeProps } from '@xyflow/react'
import { X } from '@phosphor-icons/react'
import { useCanvasCollaboration } from '../canvas-collaboration'
import { ResizableNodeFrame } from './resizable-node-frame'

function CommentNodeImpl({ id, data, selected }: NodeProps) {
  const [text, setText] = useState((data.text as string) || '')
  const [isEditing, setIsEditing] = useState(!data.text)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { deleteNodes, patchNodeData } = useCanvasCollaboration()

  // Focus on mount if editing
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    if (isEditing) return
    setText((data.text as string) || '')
  }, [data.text, isEditing])

  // Save text to node data when done editing
  const handleFinishEditing = () => {
    setIsEditing(false)
    patchNodeData(id, { text })
  }

  // Calculate width based on text content
  const getTextWidth = () => {
    if (!text) return 120
    const charWidth = 6.5 // approximate monospace char width at 11px
    const width = Math.max(80, Math.min(300, text.length * charWidth + 20))
    return width
  }

  return (
    <ResizableNodeFrame
      nodeId={id}
      data={data}
      defaultSize={{ width: 160, height: 40 }}
      bounds={{ minWidth: 180, minHeight: 96, maxWidth: 900, maxHeight: 900 }}
    >
      <div
        className="relative group flex h-full w-full items-center gap-2 px-3 py-2 rounded-full transition-all nodrag"
        style={{
        background: 'rgba(30,32,38,0.95)',
        border: selected ? '1px solid rgba(107,143,168,0.6)' : '1px solid rgba(255,255,255,0.1)',
        boxShadow: selected ? '0 0 12px rgba(107,143,168,0.2)' : '0 2px 8px rgba(0,0,0,0.3)',
      }}
        onDoubleClick={() => setIsEditing(true)}
      >
      {/* Hover delete — `nodrag` blocks React Flow's click-to-select so the
          Delete key flow doesn't reach comments. A persistent on-hover X
          is the most discoverable way out. */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          deleteNodes([id])
        }}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/80 border border-white/20 text-white/80 hover:text-white hover:bg-red-500/80 hover:border-red-400/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
        aria-label="Delete comment"
        title="Delete comment"
      >
        <X size={10} weight="bold" />
      </button>
      {/* Avatar */}
      <div 
        className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-medium"
        style={{ 
          background: 'linear-gradient(135deg, #f0a0a0 0%, #d08080 100%)',
          color: '#3d2020'
        }}
      >
        U
      </div>

      {/* Text display or input */}
      {isEditing ? (
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleFinishEditing}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              handleFinishEditing()
            }
            if (e.key === 'Escape') {
              setIsEditing(false)
            }
            e.stopPropagation()
          }}
          placeholder="Add a comment..."
          className="bg-transparent text-[11px] font-mono text-foreground/80 placeholder:text-muted-foreground/40 outline-none resize-none"
          style={{ width: Math.max(120, getTextWidth()), minHeight: 24 }}
        />
      ) : (
        <span 
          className="text-[11px] font-mono text-foreground/80 cursor-text"
          style={{ 
            minWidth: text ? 'auto' : 120,
            color: text ? undefined : 'rgba(255,255,255,0.3)'
          }}
          onClick={() => setIsEditing(true)}
        >
          {text || 'Add a comment...'}
        </span>
      )}
      </div>
    </ResizableNodeFrame>
  )
}

export const CommentNode = memo(CommentNodeImpl)
CommentNode.displayName = 'CommentNode'
