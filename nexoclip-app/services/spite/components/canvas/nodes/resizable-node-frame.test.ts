import assert from 'node:assert/strict'
import test from 'node:test'

import { createResizeSession, finalizeResize } from './resizable-node-frame'

const size = { width: 320, height: 240 }

test('cancelled resize clears the active session without a persisted size', () => {
  const session = createResizeSession(7, 100, 100, size)

  assert.deepEqual(finalizeResize(session, 7, true), { session: null, size, shouldPersist: false })
})

test('a later pointer event cannot finalize a cancelled resize session', () => {
  const session = createResizeSession(7, 100, 100, size)
  const cancelled = finalizeResize(session, 7, true)

  assert.equal(finalizeResize(cancelled.session, 7, false), null)
})

test('pointer up finalizes only the active pointer and persists its size', () => {
  const session = createResizeSession(7, 100, 100, size)

  assert.equal(finalizeResize(session, 8, false), null)
  assert.deepEqual(finalizeResize(session, 7, false), { session: null, size, shouldPersist: true })
})
