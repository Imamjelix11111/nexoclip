#!/usr/bin/env tsx

import { recoverProjectionLag } from '../realtime/recover-projections'

async function main() {
  const result = await recoverProjectionLag()
  console.log(
    `Realtime projection recovery complete. scanned=${result.scanned} recovered=${result.recovered} skipped=${result.skipped}`,
  )
}

main().catch((error) => {
  console.error('Realtime projection recovery failed.')
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
