export type LocalStateSyncGuard = {
  beginPropSync: () => () => void
  beginUserEdit: () => void
  allowsPersistence: () => boolean
}

export function createLocalStateSyncGuard(): LocalStateSyncGuard {
  let blockedSyncs = 0

  return {
    beginPropSync() {
      blockedSyncs += 1
      let finished = false
      return () => {
        if (finished) return
        finished = true
        blockedSyncs = Math.max(0, blockedSyncs - 1)
      }
    },

    beginUserEdit() {
      blockedSyncs = 0
    },

    allowsPersistence() {
      return blockedSyncs === 0
    },
  }
}
