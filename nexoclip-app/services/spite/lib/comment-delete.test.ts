import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../components/canvas/nodes/comment-node.tsx', import.meta.url),
  'utf8',
)

test('Comment delete is a non-submitting collaborative action', () => {
  // Anchor the unique Delete comment button by its aria-label
  const anchor = 'aria-label="Delete comment"'
  const anchorIdx = source.indexOf(anchor)
  assert.ok(anchorIdx > -1, 'Delete comment button not found')
  const start = source.lastIndexOf('<button', anchorIdx)
  const end = source.indexOf('</button>', anchorIdx) + '</button>'.length
  const button = source.slice(start, end)

  assert.match(button, /type="button"/)
  assert.match(button, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/)
  // Double-click must not bubble into canvas gestures
  assert.match(button, /onDoubleClick=\{\(e\) => \{ e\.preventDefault\(\); e\.stopPropagation\(\) \}\}/)
  assert.match(button, /onClick=\{\(e\) => \{/) 
  assert.match(button, /e\.preventDefault\(\)/)
  assert.match(button, /e\.stopPropagation\(\)/)
  assert.match(button, /deleteNodes\(\[id\]\)/)
  assert.equal((button.match(/deleteNodes\(\[id\]\)/g) || []).length, 1)
})
