export type MinimalNode = { id: string; type?: string | undefined | null }

/**
 * Given current nodes and a set of already-scheduled legacy deletions,
 * return the IDs of legacy note nodes that should be deleted now.
 * Adds any newly returned IDs into scheduled so they won't be returned again
 * on subsequent sync/render ticks before the Yjs projection catches up.
 */
export function selectLegacyNoteDeletionIds(
  nodes: readonly MinimalNode[],
  scheduled: Set<string>,
): string[] {
  if (!Array.isArray(nodes) || nodes.length === 0) return []
  const next: string[] = []
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string') continue
    if ((n.type as string) !== 'note') continue
    if (scheduled.has(n.id)) continue
    next.push(n.id)
  }
  for (const id of next) scheduled.add(id)
  return next
}
