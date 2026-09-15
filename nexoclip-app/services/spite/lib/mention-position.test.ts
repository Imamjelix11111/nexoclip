import test from 'node:test'
import assert from 'node:assert/strict'

import { placeMentionMenu } from './mention-position'

test('places the menu below the caret when space available', () => {
  assert.deepEqual(
    placeMentionMenu(
      { left: 100, right: 101, top: 80, bottom: 100 },
      { width: 240, height: 180 },
      { width: 1200, height: 800 },
    ),
    { left: 100, top: 108, placement: 'below' },
  )
})

test('chooses above placement when not enough room below', () => {
  assert.equal(placeMentionMenu(
    { left: 100, right: 101, top: 700, bottom: 720 },
    { width: 240, height: 180 },
    { width: 1200, height: 800 },
  ).placement, 'above')
})

test('clamps horizontally to viewport margins', () => {
  assert.equal(placeMentionMenu(
    { left: 1150, right: 1151, top: 80, bottom: 100 },
    { width: 240, height: 180 },
    { width: 1200, height: 800 },
  ).left, 952)
})
