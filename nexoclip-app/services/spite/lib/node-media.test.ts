import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveNodeMediaUrl } from './node-media'

test('prefixes legacy root-relative media URLs with the configured base path', () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/spite'
  assert.equal(
    resolveNodeMediaUrl({ outputUrl: '/api/r2-image/generations/result.png' }),
    '/spite/api/r2-image/generations/result.png',
  )
})

test('leaves already-prefixed and external media URLs unchanged', () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/spite'
  assert.equal(resolveNodeMediaUrl({ outputUrl: '/spite/api/r2-image/a.png' }), '/spite/api/r2-image/a.png')
  assert.equal(resolveNodeMediaUrl({ outputUrl: 'https://cdn.example/a.png' }), 'https://cdn.example/a.png')
})
