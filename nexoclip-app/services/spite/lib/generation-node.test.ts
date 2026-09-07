import test from 'node:test'
import assert from 'node:assert/strict'
import { completeGenerationNode } from './generation-node'

test('atomically stores completed media and clears pending generation state', () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/spite'
  assert.deepEqual(
    completeGenerationNode({
      label: 'Generator',
      status: 'in_queue',
      pendingRequestId: 'job-1',
      pendingProvider: 'byteplus',
      pendingProviderModel: 'seedance',
      pendingStartedAt: 123,
    }, '/api/r2-image/generations/result.png'),
    {
      label: 'Generator',
      status: 'completed',
      outputUrl: '/spite/api/r2-image/generations/result.png',
      error: null,
      pendingRequestId: undefined,
      pendingProvider: undefined,
      pendingProviderModel: undefined,
      pendingFalEndpoint: undefined,
      pendingStartedAt: undefined,
    },
  )
})
