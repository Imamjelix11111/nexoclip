import { createDatabaseAdapter } from './db'
import { captureProjectionPayload, projectDocument } from './projector'
import { YjsRepository } from './yjs-repository'

type ProjectionLagRepository = Pick<YjsRepository, 'loadProjectionLag' | 'loadOrImport' | 'close'>

type ProjectionRecoveryResult = {
  scanned: number
  recovered: number
  skipped: number
}

export async function recoverProjectionLag({
  repository,
  projector = projectDocument,
}: {
  repository?: ProjectionLagRepository
  projector?: typeof projectDocument
} = {}): Promise<ProjectionRecoveryResult> {
  const ownedRepository = repository ?? new YjsRepository({ database: createDatabaseAdapter() })
  const shouldCloseRepository = !repository

  try {
    const laggingProjects = await ownedRepository.loadProjectionLag()
    let recovered = 0
    let skipped = 0

    for (const entry of laggingProjects) {
      const loaded = await ownedRepository.loadOrImport(entry.projectId)
      if (loaded.projectedSeq >= loaded.durableSeq) {
        skipped += 1
        continue
      }

      await projector(entry.projectId, captureProjectionPayload(loaded.doc), loaded.durableSeq)
      recovered += 1
    }

    return {
      scanned: laggingProjects.length,
      recovered,
      skipped,
    }
  } finally {
    if (shouldCloseRepository) {
      await ownedRepository.close()
    }
  }
}
