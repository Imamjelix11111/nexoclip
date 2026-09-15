import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../components/canvas/nodes/comment-node.tsx', import.meta.url),
  'utf8',
)

test('Comment delete is a non-submitting collaborative action', () => {
  const button = source.slice(source.indexOf('<button'), source.indexOf('</button>') + 9)
  assert.match(button, /type="button"/)
  assert.match(button, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/)
  assert.match(button, /onClick=\{\(e\) => \{/) 
  assert.match(button, /e\.preventDefault\(\)/)
  assert.match(button, /e\.stopPropagation\(\)/)
  assert.match(button, /deleteNodes\(\[id\]\)/)
  assert.equal((button.match(/deleteNodes\(\[id\]\)/g) || []).length, 1)
})
