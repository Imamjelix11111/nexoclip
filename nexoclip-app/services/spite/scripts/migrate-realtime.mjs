#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from '@neondatabase/serverless'

const TRANSACTION_SETUP_SQL = "SET LOCAL lock_timeout = '5s'"

/**
 * @typedef {{ query: (sql: string) => Promise<void>, release: () => void }} MigrationClient
 * @typedef {{ connect: () => Promise<MigrationClient>, end: () => Promise<void> }} MigrationPool
 */

async function loadSetupSql() {
  const here = dirname(fileURLToPath(import.meta.url))
  const setupSqlPath = join(here, '..', 'database-setup.sql')
  return readFile(setupSqlPath, 'utf8')
}

/**
 * @param {{
 *   databaseUrl?: string,
 *   loadSetupSql?: () => Promise<string>,
 *   createPool?: (options: { connectionString: string }) => MigrationPool,
 * }=} options
 */
export async function applyRealtimeSchema({
  databaseUrl = process.env.DATABASE_URL,
  loadSetupSql: readSetupSql = loadSetupSql,
  createPool = (options) => new Pool(options),
} = {}) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  const setupSql = await readSetupSql()
  const pool = createPool({ connectionString: databaseUrl })
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query(TRANSACTION_SETUP_SQL)
    await client.query(setupSql)
    await client.query('COMMIT')
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Preserve original migration error.
    }
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

async function main() {
  await applyRealtimeSchema()
  console.log('Realtime schema migration applied successfully.')
}

export function isDirectExecution({
  moduleUrl = import.meta.url,
  argv1 = process.argv[1],
  resolvePath = resolve,
} = {}) {
  if (argv1 == null) {
    return false
  }

  return fileURLToPath(moduleUrl) === resolvePath(argv1)
}

if (isDirectExecution()) {
  main().catch((error) => {
    console.error('Realtime schema migration failed.')
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exit(1)
  })
}
