import { Pool } from '@neondatabase/serverless'

import { CANVAS_SAVE_LOCK_NS, resolveSpiteDatabaseUrl } from '../lib/db'

export const DEFAULT_REALTIME_ADVISORY_LOCK_NAMESPACE = CANVAS_SAVE_LOCK_NS

export type QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[]
  rowCount?: number | null
}

export interface Queryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>
}

export interface DatabaseAdapter extends Queryable {
  transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
}

type PoolClientLike = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>
  release(): void
}

type PoolLike = {
  connect(): Promise<PoolClientLike>
  end(): Promise<void>
}

type OwnedPoolOptions = {
  pool: PoolLike
  ownsPool: boolean
}

type SharedPoolOptions = {
  pool?: undefined
  connectionString?: string
}

type DatabaseAdapterOptions = OwnedPoolOptions | SharedPoolOptions

let sharedPool: { pool: Pool; connectionString: string } | null = null

export function getRealtimePool({
  connectionString = resolveSpiteDatabaseUrl(),
}: {
  connectionString?: string
} = {}): Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  if (!sharedPool) {
    const pool = new Pool({ connectionString })
    sharedPool = { pool, connectionString }
    return pool
  }

  if (sharedPool.connectionString !== connectionString) {
    throw new Error('Realtime pool already exists for a different connection string')
  }

  return sharedPool.pool
}

export function createDatabaseAdapter(options: DatabaseAdapterOptions = {}): DatabaseAdapter {
  const { pool, ownsPool } = resolvePoolOptions(options)

  return {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params: readonly unknown[] = [],
    ): Promise<QueryResult<Row>> {
      const client = await pool.connect()
      try {
        const result = await client.query<Row>(text, [...params])
        return {
          rows: result.rows,
          rowCount: result.rowCount,
        }
      } finally {
        client.release()
      }
    },

    async transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const txClient: Queryable = {
          query: async <Row extends Record<string, unknown> = Record<string, unknown>>(
            text: string,
            params: readonly unknown[] = [],
          ): Promise<QueryResult<Row>> => {
            const result = await client.query<Row>(text, [...params])
            return {
              rows: result.rows,
              rowCount: result.rowCount,
            }
          },
        }

        const result = await work(txClient)
        await client.query('COMMIT')
        return result
      } catch (error) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // Preserve the original transaction error.
        }
        throw error
      } finally {
        client.release()
      }
    },

    async close(): Promise<void> {
      if (!ownsPool) {
        return
      }

      await pool.end()
      if (sharedPool?.pool === pool) {
        sharedPool = null
      }
    },
  }
}

function resolvePoolOptions(options: DatabaseAdapterOptions): {
  pool: PoolLike
  ownsPool: boolean
} {
  if ('pool' in options && options.pool) {
    if (typeof options.ownsPool !== 'boolean') {
      throw new Error('createDatabaseAdapter requires explicit ownsPool when injecting a pool')
    }

    return {
      pool: options.pool,
      ownsPool: options.ownsPool,
    }
  }

  return {
    pool: getRealtimePool({ connectionString: options.connectionString }),
    ownsPool: true,
  }
}

export async function closeRealtimePool(): Promise<void> {
  if (!sharedPool) return
  await sharedPool.pool.end()
  sharedPool = null
}
