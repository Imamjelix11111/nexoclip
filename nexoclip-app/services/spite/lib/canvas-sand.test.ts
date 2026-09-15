import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Palette values required for Full Sand controls
const SAND_VALUES = [
  '#D7BD83', // --sand-bg
  '#C7AA70', // --sand-surface
  '#FFF2C8', // --sand-active
  '#EEDAA8', // --sand-border
  '#493718', // --sand-text
  '#6B542A', // --sand-muted
]

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

// Step 1: Assert left-toolbar and jobs-panel adopt the Full Sand palette values

test('left-toolbar uses all approved Full Sand palette values', () => {
  const src = read('../components/canvas/left-toolbar.tsx')
  for (const hex of SAND_VALUES) {
    assert.match(src, new RegExp(hex.replace('#', '#')))
  }
})

// Strengthened: Sand assets roots explicitly set sand borderColor and use sand active hover

test('left-toolbar sand-scoped roots set sand border/text and use sand active treatments', () => {
  const src = read('../components/canvas/left-toolbar.tsx')
  // Both sand roots have inline borderColor
  assert.match(src, /data-tour=\"assets-expanded\"[\s\S]*borderColor: 'var\(--sand-border\)'/)
  assert.match(src, /data-tour=\"assets-panel\"[\s\S]*borderColor: 'var\(--sand-border\)'/)
  // Ensure at least one sand-active hover or active class exists
  assert.match(src, /bg-\[var\(--sand-active\)\]/)
})

test('jobs-panel uses all approved Full Sand palette values', () => {
  const src = read('../components/canvas/jobs-panel.tsx')
  for (const hex of SAND_VALUES) {
    assert.match(src, new RegExp(hex.replace('#', '#')))
  }
})

// Strengthened: Jobs panel should not use backdropFilter on solid sand panel

test('jobs-panel removes obsolete backdropFilter', () => {
  const src = read('../components/canvas/jobs-panel.tsx')
  assert.doesNotMatch(src, /backdropFilter/)
})

// Strengthened: Active job rows have a distinct readable cue on sand

test('jobs-panel applies a distinct sand active treatment for active jobs', () => {
  const src = read('../components/canvas/jobs-panel.tsx')
  assert.match(src, /isActive \? 'bg-\[var\(--sand-active\)\]'/)
})

// Ensure the Full Sand panel token is not applied to unrelated controls

test('canvas-toolbar, bottom-bar, image-node, and video-node do NOT receive the sand panel token', () => {
  const toolbar = read('../components/canvas/canvas-toolbar.tsx')
  const bottombar = read('../components/canvas/bottom-bar.tsx')
  const imagenode = read('../components/canvas/nodes/image-node.tsx')
  const videonode = read('../components/canvas/nodes/video-node.tsx')
  for (const src of [toolbar, bottombar, imagenode, videonode]) {
    assert.doesNotMatch(src, /--sand-bg/)
  }
})

// Preserve explicit semantic red/green status classes in Jobs

test('jobs-panel preserves explicit text-red- and text-green- semantic classes', () => {
  const src = read('../components/canvas/jobs-panel.tsx')
  assert.match(src, /text-red-/)
  assert.match(src, /text-green-/)
})
