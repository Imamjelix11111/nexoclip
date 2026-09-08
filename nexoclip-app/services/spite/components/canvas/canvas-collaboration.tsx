'use client'

import { createContext, useContext } from 'react'
import type { Edge, Node } from '@xyflow/react'

import type { UseRealtimeCanvasResult } from '@/hooks/use-realtime-canvas'

type NodeDataPatch = Record<string, unknown>
type NodePatch = Parameters<UseRealtimeCanvasResult['commands']['patchNode']>[1]

type CanvasCollaborationValue = UseRealtimeCanvasResult & {
  addNodes: (nodes: Node[]) => void
  addEdges: (edges: Edge[]) => void
  deleteNodes: (nodeIds: string[]) => void
  deleteEdges: (edgeIds: string[]) => void
  patchNodes: (patches: Array<{ id: string; patch: NodePatch }>) => void
  patchNodeData: (nodeId: string, patch: NodeDataPatch) => void
  replaceShot: (nodeId: string, shotId: string) => void
  createNextShot: (nodeId: string) => string | null
}

const CanvasCollaborationContext = createContext<CanvasCollaborationValue | null>(null)

export function CanvasCollaborationProvider({
  value,
  children,
}: {
  value: UseRealtimeCanvasResult
  children: React.ReactNode
}) {
  const findNode = (nodeId: string) => value.allNodes.find((node) => node.id === nodeId) as Node | undefined

  const collaborationValue: CanvasCollaborationValue = {
    ...value,
    addNodes(nodes) {
      if (nodes.length === 0) return
      value.commands.batch(({ createNode }) => {
        for (const node of nodes) {
          createNode(node as any)
        }
      })
    },
    addEdges(edges) {
      if (edges.length === 0) return
      value.commands.batch(({ createEdge }) => {
        for (const edge of edges) {
          createEdge(edge as any)
        }
      })
    },
    deleteNodes(nodeIds) {
      if (nodeIds.length === 0) return
      value.commands.batch(({ deleteNode }) => {
        for (const nodeId of nodeIds) {
          deleteNode(nodeId)
        }
      })
    },
    deleteEdges(edgeIds) {
      if (edgeIds.length === 0) return
      value.commands.batch(({ deleteEdge }) => {
        for (const edgeId of edgeIds) {
          deleteEdge(edgeId)
        }
      })
    },
    patchNodes(patches) {
      if (patches.length === 0) return
      value.commands.batch(({ patchNode }) => {
        for (const entry of patches) {
          patchNode(entry.id, entry.patch)
        }
      })
    },
    patchNodeData(nodeId, patch) {
      if (!findNode(nodeId)) return
      value.commands.patchNodeData(nodeId, patch)
    },
    replaceShot(nodeId, shotId) {
      const self = findNode(nodeId)
      if (!self) return
      const sceneId = (self.data as Record<string, unknown> | undefined)?.sceneId as string | undefined
      value.commands.batch(({ patchNode }) => {
        for (const node of value.allNodes as Node[]) {
          const data = (node.data as Record<string, unknown>) || {}
          const sameScene = !sceneId || data.sceneId === sceneId
          const currentShotId = (data.shotId || data.selectedShotId) as string | undefined
          if (node.id === nodeId) {
            patchNode(node.id, {
              data: {
                ...data,
                shotId,
                selectedShotId: undefined,
              },
            })
            continue
          }
          if (!sameScene || currentShotId !== shotId) continue
          patchNode(node.id, {
            data: {
              ...data,
              shotId: undefined,
              selectedShotId: undefined,
            },
          })
        }
      })
    },
    createNextShot(nodeId) {
      const self = findNode(nodeId)
      if (!self) return null
      const sceneId = (self.data as Record<string, unknown> | undefined)?.sceneId as string | undefined
      let maxNum = 0
      for (const node of value.allNodes as Node[]) {
        const data = (node.data as Record<string, unknown>) || {}
        if (sceneId && data.sceneId !== sceneId) continue
        const match = String(data.shotId || data.selectedShotId || '').match(/^shot-(\d+)$/)
        if (match) {
          maxNum = Math.max(maxNum, Number.parseInt(match[1], 10))
        }
      }
      const shotId = `shot-${maxNum + 1}`
      value.commands.patchNode(nodeId, {
        data: {
          ...((self.data as Record<string, unknown>) || {}),
          shotId,
          selectedShotId: undefined,
        },
      })
      return shotId
    },
  }

  return (
    <CanvasCollaborationContext.Provider value={collaborationValue}>
      {children}
    </CanvasCollaborationContext.Provider>
  )
}

export function useCanvasCollaboration(): CanvasCollaborationValue {
  const value = useContext(CanvasCollaborationContext)
  if (!value) {
    throw new Error('useCanvasCollaboration must be used within CanvasCollaborationProvider')
  }
  return value
}
