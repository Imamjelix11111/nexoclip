import test from 'node:test'
import assert from 'node:assert/strict'
import { withBasePath, withGenerationOutputBasePath } from './base-path'

test('prefixes root-relative application URLs', () => {
  assert.equal(withBasePath('/api/projects', '/spite'), '/spite/api/projects')
  assert.equal(withBasePath('/', '/spite'), '/spite')
})

test('keeps main-app generation asset URLs outside the Spite base path', () => {
  assert.equal(withGenerationOutputBasePath('/api/assets/asset-1/download?workspace_id=ws'), '/api/assets/asset-1/download?workspace_id=ws')
})

test('does not duplicate the prefix or alter external URLs', () => {
  assert.equal(withBasePath('/spite/api/projects', '/spite'), '/spite/api/projects')
  assert.equal(withBasePath('https://example.com/a', '/spite'), 'https://example.com/a')
})
