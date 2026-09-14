import assert from 'node:assert/strict'
import test from 'node:test'

import {
  closeRealtimePool,
  createDatabaseAdapter,
  getRealtimePool,
  type QueryResult,
} from './db'

type FakePoolClient = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>
  release(): void
}

type FakePool = {
  connect(): Promise<FakePoolClient>
  end(): Promise<void>
}

test('getRealtimePool defaults to the dedicated Spite URL', async () => {
  await closeRealtimePool()
  const originalSpite = process.env.DATABASE_URL_SPITE
  const originalDatabase = process.env.DATABASE_URL
  process.env.DATABASE_URL_SPITE = 'postgres://spite'
  process.env.DATABASE_URL = 'postgres://main'

  try {
    assert.ok(getRealtimePool({}))
  } finally {
    await closeRealtimePool()
    if (originalSpite === undefined) delete process.env.DATABASE_URL_SPITE
    else process.env.DATABASE_URL_SPITE = originalSpite
    if (originalDatabase === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabase
  }
})

test('getRealtimePool fails closed when asked to reuse a different connection string', async () => {
  await closeRealtimePool()

  try {
    const first = getRealtimePool({ connectionString: 'postgres://first' })

    assert.ok(first)
    assert.throws(
      () => getRealtimePool({ connectionString: 'postgres://second' }),
      /different connection string/i,
    )
  } finally {
    await closeRealtimePool()
  }
})

test('createDatabaseAdapter close does not end an injected caller-owned pool', async () => {
  let ended = false

  const pool: FakePool = {
    async connect() {
      return {
        async query() {
          return { rows: [], rowCount: 0 }
        },
        release() {},
      }
    },
    async end() {
      ended = true
    },
  }

  const adapter = createDatabaseAdapter({ pool, ownsPool: false })
  await adapter.close()

  assert.equal(ended, false)
})

test('createDatabaseAdapter close ends an injected adapter-owned pool when ownership is explicit', async () => {
  let ended = false

  const pool: FakePool = {
    async connect() {
      return {
        async query() {
          return { rows: [], rowCount: 0 }
        },
        release() {},
      }
    },
    async end() {
      ended = true
    },
  }

  const adapter = createDatabaseAdapter({ pool, ownsPool: true })
  await adapter.close()

  assert.equal(ended, true)
})
