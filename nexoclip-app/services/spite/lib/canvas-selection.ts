import type { NodeChange } from '@xyflow/react'

export function reconcileSelectedNodeIds(
  previous: string[],
  changes: NodeChange[],
  visibleNodeIds: ReadonlySet<string>,
): string[] {
  if (changes.length === 0) {
    return previous
  }

  const next = new Set(previous.filter((id) => visibleNodeIds.has(id)))
  for (const change of changes) {
    if (change.type !== 'select') continue
    if (!visibleNodeIds.has(change.id)) continue
    if (change.selected) next.add(change.id)
    else next.delete(change.id)
  }

  const nextIds = Array.from(next)
  return arraysEqual(previous, nextIds) ? previous : nextIds
}

export function filterSelectedNodeIdsToVisible(
  previous: string[],
  visibleNodeIds: ReadonlySet<string>,
): string[] {
  const next = previous.filter((id) => visibleNodeIds.has(id))
  return arraysEqual(previous, next) ? previous : next
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}
