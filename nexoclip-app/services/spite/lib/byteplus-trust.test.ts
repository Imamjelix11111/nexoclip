import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyBytePlusTrustState,
  bytePlusTrustUrl,
  safeBytePlusTrustError,
  shouldPollBytePlusTrust,
  trustForSeedanceView,
} from '@/lib/byteplus-trust'

test('trust URL targets the unprefixed main app and encodes the asset ID', () => {
  assert.equal(
    bytePlusTrustUrl('asset/with space'),
    '/api/assets/asset%2Fwith%20space/byteplus-trust',
  )
})

test('trust UI is available only for workspace images', () => {
  assert.equal(trustForSeedanceView('video', { status: 'not_trusted' }), null)
  assert.equal(trustForSeedanceView('audio', { status: 'failed' }), null)
  assert.deepEqual(trustForSeedanceView('image', { status: 'not_trusted' }), {
    label: 'Not trusted for Seedance',
    action: 'Trust for Seedance',
    disabled: false,
  })
})

test('processing and active trust states have accessible labels and no repeat action', () => {
  assert.deepEqual(trustForSeedanceView('image', { status: 'processing' }), {
    label: 'Trusting for Seedance',
    action: 'Trusting…',
    disabled: true,
  })
  assert.deepEqual(trustForSeedanceView('image', { status: 'active' }), {
    label: 'Trusted for Seedance',
    action: null,
    disabled: true,
  })
})

test('failed trust state offers a retry with safe copy', () => {
  assert.deepEqual(trustForSeedanceView('image', {
    status: 'failed',
    error: { code: 'provider-secret', message: 'raw provider response asset-123' },
  }), {
    label: 'Trust failed',
    action: 'Retry trust',
    disabled: false,
    message: 'Could not trust this image. Try again.',
  })
})

test('missing BytePlus configuration gets an actionable setup message', () => {
  assert.equal(
    safeBytePlusTrustError({ code: 'BYTEPLUS_ASSETS_NOT_CONFIGURED', message: 'internal details' }),
    'BytePlus trusted assets are not configured. Ask an administrator to complete setup.',
  )
})

test('polling runs only for a visible selected image that is processing', () => {
  assert.equal(shouldPollBytePlusTrust({ detailVisible: true, type: 'image', status: 'processing' }), true)
  assert.equal(shouldPollBytePlusTrust({ detailVisible: false, type: 'image', status: 'processing' }), false)
  assert.equal(shouldPollBytePlusTrust({ detailVisible: true, type: 'video', status: 'processing' }), false)
  assert.equal(shouldPollBytePlusTrust({ detailVisible: true, type: 'image', status: 'active' }), false)
  assert.equal(shouldPollBytePlusTrust({ detailVisible: true, type: 'image', status: 'failed' }), false)
})

test('trust responses update the matching list item without requiring an ID in the payload', () => {
  const assets = [
    { id: 'image-1', byteplus_trust: { status: 'not_trusted' as const } },
    { id: 'image-2', byteplus_trust: { status: 'active' as const } },
  ]

  const updated = applyBytePlusTrustState(assets, 'image-1', { status: 'processing' })

  assert.deepEqual(updated, [
    { id: 'image-1', byteplus_trust: { status: 'processing' } },
    assets[1],
  ])
  assert.equal(updated[1], assets[1])
})
