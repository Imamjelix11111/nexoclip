import type { RealtimeCanvasCommands } from '@/hooks/use-realtime-canvas'
import type { ProjectRuntimeState } from '@/realtime/project-runtime'

export type CanvasSaveIndicator = {
  label: 'Saved' | 'Pending' | 'Saving' | 'Degraded' | 'Read-only'
  persisted: boolean
}

type CanvasRuntimeControls = {
  commands: RealtimeCanvasCommands
  undo: () => void
  redo: () => void
}

const READ_ONLY_COMMANDS: RealtimeCanvasCommands = {
  applyNodeChanges: () => {},
  applyEdgeChanges: () => {},
  createNode: () => {},
  patchNode: () => {},
  patchNodeData: () => {},
  updateNodeData: () => {},
  replaceShot: () => {},
  createNextShot: () => null,
  deleteNode: () => {},
  createEdge: () => {},
  deleteEdge: () => {},
  duplicateNodes: () => [],
  connect: () => null,
  createScene: () => 'scene-1',
  deleteScene: () => {},
  switchScene: () => {},
  batch: () => {},
}

export function getCanvasSaveIndicator(status: ProjectRuntimeState): CanvasSaveIndicator {
  switch (status) {
    case 'PERSISTED':
      return { label: 'Saved', persisted: true }
    case 'PERSISTING':
      return { label: 'Saving', persisted: false }
    case 'DEGRADED':
      return { label: 'Degraded', persisted: false }
    case 'READ_ONLY':
      return { label: 'Read-only', persisted: false }
    case 'SYNCED':
    default:
      return { label: 'Pending', persisted: false }
  }
}

export function getCanvasRuntimeCapabilities(status: ProjectRuntimeState): {
  allowDocumentMutation: boolean
  allowPresence: true
} {
  return {
    allowDocumentMutation: status !== 'READ_ONLY',
    allowPresence: true,
  }
}

export function guardCanvasRuntimeControls<T extends CanvasRuntimeControls>(
  controls: T,
  status: ProjectRuntimeState,
): T {
  if (status !== 'READ_ONLY') {
    return controls
  }

  return {
    ...controls,
    commands: READ_ONLY_COMMANDS,
    undo: () => {},
    redo: () => {},
  }
}
