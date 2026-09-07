import test from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedRehostSource } from './r2-upload'

test('allows trusted BytePlus output hosts with nested subdomains', () => {
  assert.equal(
    isAllowedRehostSource('https://ark-content-generation-v2-ap-southeast-1.tos-ap-southeast-1.volces.com/result.png'),
    true,
  )
})

test('rejects deceptive and insecure output hosts', () => {
  assert.equal(isAllowedRehostSource('https://volces.com.evil.example/result.png'), false)
  assert.equal(isAllowedRehostSource('http://a.b.volces.com/result.png'), false)
})
