export type PersistedMention = {
  folderId: string
  name: string
  selectedAssetIds: string[]
}

export function mentionStateKey(text: string, mentions: PersistedMention[]): string {
  // Normalize selectedAssetIds (dedupe + sort) and sort mentions by
  // folderId so that equivalent semantic states with different ordering
  // don't produce different keys. Do not mutate the original arrays.
  const normalized = mentions
    .map((m) => [
      m.folderId,
      m.name,
      Array.from(new Set(m.selectedAssetIds)).sort(),
    ] as [string, string, string[]])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return JSON.stringify([text, normalized])
}

export function shouldApplyRemoteMentionState({
  editing,
  localText,
  localMentions,
  incomingText,
  incomingMentions,
}: {
  editing: boolean
  localText: string
  localMentions: PersistedMention[]
  incomingText: string
  incomingMentions: PersistedMention[]
}): boolean {
  if (!editing) return true
  if (localText !== incomingText) return false
  return mentionStateKey(localText, localMentions) !== mentionStateKey(incomingText, incomingMentions)
}
