import test from 'node:test'
import assert from 'node:assert/strict'
import { withBasePath } from './base-path'

test('prefixes root-relative application URLs', () => {
  assert.equal(withBasePath('/api/projects', '/spite'), '/spite/api/projects')
  assert.equal(withBasePath('/', '/spite'), '/spite')
})

test('does not duplicate the prefix or alter external URLs', () => {
  assert.equal(withBasePath('/spite/api/projects', '/spite'), '/spite/api/projects')
  assert.equal(withBasePath('https://example.com/a', '/spite'), 'https://example.com/a')
})
