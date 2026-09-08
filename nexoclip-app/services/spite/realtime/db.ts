import { Pool } from '@neondatabase/serverless'

import { CANVAS_SAVE_LOCK_NS } from '../lib/db'

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

let sharedPool: Pool | null = null

export function getRealtimePool({
  connectionString = process.env.DATABASE_URL,
}: {
  connectionString?: string
} = {}): Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  if (!sharedPool) {
    sharedPool = new Pool({ connectionString })
  }

  return sharedPool
}

export function createDatabaseAdapter(pool: PoolLike = getRealtimePool()): DatabaseAdapter {
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
      await pool.end()
      if (pool === sharedPool) {
        sharedPool = null
      }
    },
  }
}

export async function closeRealtimePool(): Promise<void> {
  if (!sharedPool) return
  await sharedPool.end()
  sharedPool = null
}
