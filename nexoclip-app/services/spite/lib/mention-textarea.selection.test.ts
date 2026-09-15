import test from 'node:test'
import assert from 'node:assert/strict'

import { captureCaretOffset, restoreCaretFromOffset } from '../components/canvas/mention-textarea'

let JSDOM: any
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  JSDOM = require('jsdom').JSDOM
} catch (e) {
  JSDOM = null
}

if (!JSDOM) {
  // Can't run DOM-dependent tests in this environment; mark as skipped so
  // CI/test runner output remains clear.
  test.skip('capture and restore collapsed caret across a chip boundary', () => {})
} else {
  // Setup a JSDOM environment for DOM APIs used by the mapping helpers.
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  // @ts-ignore - test runner globals
  global.window = dom.window
  // @ts-ignore
  global.document = dom.window.document
  // @ts-ignore
  global.Node = dom.window.Node

  // Pure mapping tests for caret offset capture/restore. These are best-effort
  // and exercise the serialized offset mapping used during DOM re-renders.

  test('capture and restore collapsed caret across a chip boundary', () => {
  const el = document.createElement('div')
  const before = document.createTextNode('Hello ')
  const chip = document.createElement('span')
  chip.dataset.mention = '1'
  chip.dataset.name = 'Nathan'
  chip.dataset.folderId = 'character-1'
  chip.textContent = 'Nathan'
  const after = document.createTextNode(' world')
  el.appendChild(before)
  el.appendChild(chip)
  el.appendChild(after)

  // Place caret after the 'Hello ' (offset 6)
  const range = document.createRange()
  range.setStart(before, 6)
  range.collapse(true)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)

  const offset = captureCaretOffset(el)
  assert.equal(typeof offset, 'number')
  assert.equal(offset, 6)

  // Simulate a DOM re-render that reconstructs the nodes.
  const val = el.textContent || ''
  el.innerHTML = ''
  const b2 = document.createTextNode('Hello ')
  const chip2 = document.createElement('span')
  chip2.dataset.mention = '1'
  chip2.dataset.name = 'Nathan'
  chip2.dataset.folderId = 'character-1'
  chip2.textContent = 'Nathan'
  const a2 = document.createTextNode(' world')
  el.appendChild(b2)
  el.appendChild(chip2)
  el.appendChild(a2)

  // Restore caret
  restoreCaretFromOffset(el, offset!)
  const sel2 = window.getSelection()!
  assert.equal(sel2.rangeCount, 1)
  const r2 = sel2.getRangeAt(0)
  assert.equal(r2.startContainer.nodeType, Node.TEXT_NODE)
  assert.equal(r2.startOffset, 6)
})
}

