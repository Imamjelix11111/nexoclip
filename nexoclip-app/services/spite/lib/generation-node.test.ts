import test from 'node:test'
import assert from 'node:assert/strict'
import { completeGenerationNode } from './generation-node'

test('keeps durable main-app asset URLs outside the Spite base path', () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/spite'
  assert.equal(
    completeGenerationNode({}, '/api/assets/asset-1/download?workspace_id=ws').outputUrl,
    '/api/assets/asset-1/download?workspace_id=ws',
  )
})

test('atomically stores completed media while retaining durable generation identity', () => {
  process.env.NEXT_PUBLIC_BASE_PATH = '/spite'
  assert.deepEqual(
    completeGenerationNode({
      label: 'Generator',
      status: 'in_queue',
      generationId: 'generation-1',
      pendingRequestId: 'job-1',
      pendingProvider: 'byteplus',
      pendingProviderModel: 'seedance',
      pendingFalEndpoint: 'fal-ai/seedance',
      pendingStartedAt: 123,
    }, '/api/r2-image/generations/result.png'),
    {
      label: 'Generator',
      status: 'completed',
      generationId: 'generation-1',
      outputUrl: '/spite/api/r2-image/generations/result.png',
      error: null,
    },
  )
})
