import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSpiteDatabaseUrl } from './db'

test('prefers the dedicated Spite database URL over the shared app URL', () => {
  assert.equal(
    resolveSpiteDatabaseUrl({
      DATABASE_URL: 'postgres://main',
      DATABASE_URL_SPITE: 'postgres://spite',
    }),
    'postgres://spite',
  )
})

test('falls back to DATABASE_URL for legacy local environments', () => {
  assert.equal(resolveSpiteDatabaseUrl({ DATABASE_URL: 'postgres://main' }), 'postgres://main')
})
