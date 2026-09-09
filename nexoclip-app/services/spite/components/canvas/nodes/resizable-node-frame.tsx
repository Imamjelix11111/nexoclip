'use client'

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

import { useCanvasCollaboration } from '../canvas-collaboration'
import { clampNodeSize } from '@/lib/canvas-node-interactions'

type NodeData = Record<string, unknown>
type NodeSize = { width: number; height: number }
type NodeSizeBounds = {
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
}

type ResizableNodeFrameProps = {
  nodeId: string
  data: NodeData
  bounds: NodeSizeBounds
  defaultSize: NodeSize
  className?: string
  children: ReactNode
}

export function ResizableNodeFrame({
  nodeId,
  data,
  bounds,
  defaultSize,
  className,
  children,
}: ResizableNodeFrameProps) {
  const { patchNodeData } = useCanvasCollaboration()
  const { minWidth, minHeight, maxWidth, maxHeight } = bounds
  const sizeFromData = clampNodeSize({
    width: typeof data.width === 'number' ? data.width : defaultSize.width,
    height: typeof data.height === 'number' ? data.height : defaultSize.height,
  }, bounds)
  const [size, setSize] = useState(sizeFromData)
  const sizeRef = useRef(sizeFromData)
  const resizeRef = useRef<{ startX: number; startY: number; size: NodeSize } | null>(null)

  useEffect(() => {
    sizeRef.current = sizeFromData
    setSize(sizeFromData)
  }, [data.height, data.width, defaultSize.height, defaultSize.width, maxHeight, maxWidth, minHeight, minWidth])

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    resizeRef.current = { startX: event.clientX, startY: event.clientY, size: sizeRef.current }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const start = resizeRef.current
    if (!start) return
    const nextSize = clampNodeSize({
      width: start.size.width + event.clientX - start.startX,
      height: start.size.height + event.clientY - start.startY,
    }, bounds)
    sizeRef.current = nextSize
    setSize(nextSize)
  }

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return
    resizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    patchNodeData(nodeId, sizeRef.current)
  }

  return (
    <div className={`relative group ${className ?? ''}`} style={size}>
      {children}
      <div
        aria-label="Resize node"
        className="nodrag absolute right-0 bottom-0 h-5 w-5 cursor-se-resize touch-none"
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={finishResize}
      >
        <svg className="absolute right-1 bottom-1" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M 1 9 L 9 1 M 5 9 L 9 5" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
        </svg>
      </div>
    </div>
  )
}
