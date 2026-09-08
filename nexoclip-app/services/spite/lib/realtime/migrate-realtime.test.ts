import assert from 'node:assert/strict'
import test from 'node:test'

import { applyRealtimeSchema } from '../../scripts/migrate-realtime.mjs'

type FakeClient = {
  query: (sql: string) => Promise<void>
  release: () => void
}

type FakePool = {
  connect: () => Promise<FakeClient>
  end: () => Promise<void>
}

test('applyRealtimeSchema wraps schema execution in explicit transaction and releases client', async () => {
  const calls: string[] = []
  let released = false
  let ended = false

  const client: FakeClient = {
    async query(sql) {
      calls.push(sql)
    },
    release() {
      released = true
    },
  }

  const pool: FakePool = {
    async connect() {
      return client
    },
    async end() {
      ended = true
    },
  }

  await applyRealtimeSchema({
    databaseUrl: 'postgres://example',
    loadSetupSql: async () => 'SELECT 1;',
    createPool: () => pool,
  })

  assert.deepEqual(calls, ['BEGIN', "SET LOCAL lock_timeout = '5s'", 'SELECT 1;', 'COMMIT'])
  assert.equal(released, true)
  assert.equal(ended, true)
})

test('applyRealtimeSchema rolls back on error and still releases client/pool', async () => {
  const calls: string[] = []
  let released = false
  let ended = false

  const client: FakeClient = {
    async query(sql) {
      calls.push(sql)
      if (sql === 'SELECT broken;') {
        throw new Error('boom')
      }
    },
    release() {
      released = true
    },
  }

  const pool: FakePool = {
    async connect() {
      return client
    },
    async end() {
      ended = true
    },
  }

  await assert.rejects(
    applyRealtimeSchema({
      databaseUrl: 'postgres://example',
      loadSetupSql: async () => 'SELECT broken;',
      createPool: () => pool,
    }),
    /boom/,
  )

  assert.deepEqual(calls, ['BEGIN', "SET LOCAL lock_timeout = '5s'", 'SELECT broken;', 'ROLLBACK'])
  assert.equal(released, true)
  assert.equal(ended, true)
})
