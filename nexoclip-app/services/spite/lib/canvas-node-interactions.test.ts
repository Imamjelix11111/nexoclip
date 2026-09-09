import assert from 'node:assert/strict'
import test from 'node:test'
import type { Edge, Node } from '@xyflow/react'

import {
  clampNodeSize,
  parseAspectRatio,
  resolveFollowTarget,
  resolveIncomingPrompt,
} from './canvas-node-interactions'

const nodes: Node[] = [
  { id: 'prompt-a', type: 'prompt', position: { x: 0, y: 0 }, data: { prompt: ' alpha ' } },
  { id: 'prompt-b', type: 'prompt', position: { x: 0, y: 0 }, data: { prompt: ' beta ' } },
  { id: 'image-1', type: 'image', position: { x: 50, y: 75 }, data: {} },
  { id: 'image-2', type: 'image', position: { x: 12, y: 34 }, data: { sceneId: 'scene-2' } },
]

const edgeA: Edge = {
  id: 'edge-a',
  source: 'prompt-a',
  target: 'image-1',
  targetHandle: 'prompt-in',
}
const edgeB: Edge = {
  id: 'edge-b',
  source: 'prompt-b',
  target: 'image-1',
  targetHandle: 'prompt-in',
}

test('resolveIncomingPrompt uses the first prompt edge by ID', () => {
  assert.deepEqual(resolveIncomingPrompt('image-1', nodes, [edgeB, edgeA]), {
    connected: true,
    prompt: 'alpha',
  })
})

test('resolveIncomingPrompt ignores non-prompt source nodes', () => {
  assert.deepEqual(resolveIncomingPrompt('image-1', nodes, [{ ...edgeA, source: 'image-2' }]), {
    connected: false,
    prompt: '',
  })
})

test('parseAspectRatio falls back for malformed values', () => {
  assert.equal(parseAspectRatio('bad', '16:9'), 16 / 9)
})

test('parseAspectRatio accepts positive numeric ratios', () => {
  assert.equal(parseAspectRatio('4:3', '16:9'), 4 / 3)
})

test('clampNodeSize raises dimensions below their minimum bounds', () => {
  assert.deepEqual(
    clampNodeSize({ width: 80, height: 90 }, { minWidth: 100, maxWidth: 800, minHeight: 120, maxHeight: 600 }),
    { width: 100, height: 120 },
  )
})

test('clampNodeSize lowers dimensions above their maximum bounds', () => {
  assert.deepEqual(
    clampNodeSize({ width: 900, height: 700 }, { minWidth: 100, maxWidth: 800, minHeight: 120, maxHeight: 600 }),
    { width: 800, height: 600 },
  )
})

test('resolveFollowTarget prefers cursor then selected node', () => {
  assert.deepEqual(resolveFollowTarget({ cursor: { x: 12, y: 34 }, selection: { nodeIds: ['image-2'] } }, nodes), {
    sceneId: 'scene-2',
    point: { x: 12, y: 34 },
  })
})

test('resolveFollowTarget falls back to the first selected node', () => {
  assert.deepEqual(resolveFollowTarget({ selection: { nodeIds: ['image-2'] } }, nodes), {
    sceneId: 'scene-2',
    point: { x: 12, y: 34 },
  })
})

test('resolveFollowTarget returns an empty target when the peer has no cursor or selected node', () => {
  assert.deepEqual(resolveFollowTarget({ selection: { nodeIds: ['missing'] } }, nodes), {})
})
