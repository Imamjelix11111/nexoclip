import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../components/canvas/canvas-workspace.tsx', import.meta.url),
  'utf8',
)

test('ReactFlow receives a stable defaultEdgeOptions reference', () => {
  assert.match(source, /const DEFAULT_EDGE_OPTIONS[^=]*=/)
  assert.match(source, /defaultEdgeOptions=\{DEFAULT_EDGE_OPTIONS\}/)
  assert.doesNotMatch(source, /defaultEdgeOptions=\{\{/)
})
