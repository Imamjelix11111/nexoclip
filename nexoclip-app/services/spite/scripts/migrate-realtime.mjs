#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from '@neondatabase/serverless'

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  const here = dirname(fileURLToPath(import.meta.url))
  const setupSqlPath = join(here, '..', 'database-setup.sql')
  const setupSql = await readFile(setupSqlPath, 'utf8')

  const pool = new Pool({ connectionString: databaseUrl })

  try {
    await pool.query(setupSql)
    console.log('Realtime schema migration applied successfully.')
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('Realtime schema migration failed.')
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exit(1)
})
