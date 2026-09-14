import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

for (const node of ['image', 'video']) {
  test(`${node} node reacts immediately to durable terminal state updates`, () => {
    const source = readFileSync(
      new URL(`../components/canvas/nodes/${node}-node.tsx`, import.meta.url),
      'utf8',
    )
    const syncEffect = source.match(
      /const durableStatus = data\.generationStatus[\s\S]*?\}, \[([^\]]+)\]\)/,
    )

    assert.ok(syncEffect, 'prop-to-local-state synchronization effect must exist')
    assert.match(syncEffect[1], /data\.generationStatus/)
    assert.match(syncEffect[1], /data\.generationError/)
  })

  test(`${node} node keeps regeneration source wiring durable`, () => {
    const source = readFileSync(
      new URL(`../components/canvas/nodes/${node}-node.tsx`, import.meta.url),
      'utf8',
    )

    assert.doesNotMatch(source, /setOutputUrl\(null\)/)
    assert.match(source, /if \(pending && active && !generationId\)/)
    assert.match(source, /<GenerationFeedbackOverlay/)
    assert.match(source, /getTerminalGenerationToast/)
  })
}
