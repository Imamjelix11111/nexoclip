export type PersistedMention = {
  folderId: string
  name: string
  selectedAssetIds: string[]
}

export function mentionStateKey(text: string, mentions: PersistedMention[]): string {
  return JSON.stringify([
    text,
    mentions.map((mention) => [
      mention.folderId,
      mention.name,
      mention.selectedAssetIds,
    ]),
  ])
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
