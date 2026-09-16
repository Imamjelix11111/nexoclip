import test from 'node:test'
import assert from 'node:assert/strict'

import { isUsableCaretRect, placeMentionMenu } from './mention-position'

test('places the menu eight pixels above a caret when space permits', () => {
  assert.deepEqual(
    placeMentionMenu(
      { left: 500, right: 500, top: 400, bottom: 420 },
      { width: 240, height: 180 },
      { width: 1200, height: 800 },
    ),
    { left: 500, top: 212, placement: 'above' },
  )
})

test('accepts a zero-width collapsed caret with usable viewport geometry', () => {
  assert.equal(isUsableCaretRect({
    left: 580,
    right: 580,
    top: 490,
    bottom: 550,
    width: 0,
    height: 60,
  }), true)
})

test('rejects all-zero and non-finite caret geometry', () => {
  assert.equal(isUsableCaretRect({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }), false)
  assert.equal(isUsableCaretRect({ left: Number.NaN, right: 0, top: 0, bottom: 20, width: 0, height: 20 }), false)
})

test('falls below when the menu cannot fit above', () => {
  assert.equal(placeMentionMenu(
    { left: 100, right: 100, top: 40, bottom: 60 },
    { width: 240, height: 180 },
    { width: 1200, height: 800 },
  ).placement, 'below')
})

test('clamps horizontally to viewport margins', () => {
  assert.equal(placeMentionMenu(
    { left: 1150, right: 1150, top: 400, bottom: 420 },
    { width: 240, height: 180 },
    { width: 1200, height: 800 },
  ).left, 952)
})

// Additional geometry edge-case tests

test('clamps left to margin when menu is wider than viewport', () => {
  const pos = placeMentionMenu(
    { left: 600, right: 600, top: 400, bottom: 420 },
    { width: 1400, height: 180 },
    { width: 1200, height: 800 },
  )
  assert.equal(pos.left, 8)
})

test('clamps top to margin when menu is taller than viewport or viewport is very small', () => {
  const pos = placeMentionMenu(
    { left: 100, right: 120, top: 200, bottom: 220 },
    { width: 240, height: 1000 },
    { width: 1200, height: 500 },
  )
  assert.equal(pos.top, 8)
})

test('rejects inverted caret rects where right < left or bottom <= top', () => {
  assert.equal(isUsableCaretRect({ left: 100, right: 90, top: 200, bottom: 210, width: -10, height: 10 }), false)
  assert.equal(isUsableCaretRect({ left: 100, right: 120, top: 200, bottom: 200, width: 20, height: 0 }), false)
})
