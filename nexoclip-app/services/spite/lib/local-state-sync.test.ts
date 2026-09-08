import assert from 'node:assert/strict'
import test from 'node:test'

import { createLocalStateSyncGuard } from './local-state-sync'

test('local state sync guard blocks persistence during prop-driven synchronization', () => {
  const guard = createLocalStateSyncGuard()

  const finish = guard.beginPropSync()
  assert.equal(guard.allowsPersistence(), false)

  finish()
  assert.equal(guard.allowsPersistence(), true)
})

test('local state sync guard restores persistence immediately for user edits', () => {
  const guard = createLocalStateSyncGuard()

  const finish = guard.beginPropSync()
  assert.equal(guard.allowsPersistence(), false)

  guard.beginUserEdit()
  assert.equal(guard.allowsPersistence(), true)

  finish()
  assert.equal(guard.allowsPersistence(), true)
})
