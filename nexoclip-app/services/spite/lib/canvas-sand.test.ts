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

// Strengthened: Forbid representative theme leakage tokens in Full Sand regions

test('sand panels do not contain text-foreground/text-muted-foreground or white hover tokens', () => {
  const left = read('../components/canvas/left-toolbar.tsx')
  const jobs = read('../components/canvas/jobs-panel.tsx')
  for (const src of [left, jobs]) {
    assert.doesNotMatch(src, /text-foreground/)
    assert.doesNotMatch(src, /text-muted-foreground/)
    assert.doesNotMatch(src, /hover:bg-white\//)
  }
})

// New: Jobs panel must not use unsupported opacity utilities; require arbitrary opacities instead

test('jobs-panel replaces unsupported opacity utilities with arbitrary values', () => {
  const src = read('../components/canvas/jobs-panel.tsx')
  assert.doesNotMatch(src, /opacity-55/)
  assert.doesNotMatch(src, /opacity-35/)
  assert.match(src, /opacity-\[0\.55\]/)
  assert.match(src, /opacity-\[0\.35\]/)
})

// New: Left toolbar search inputs should use placeholder:opacity-40 instead of applying opacity-40 to the whole input

test('left-toolbar search inputs use placeholder:opacity-40', () => {
  const src = read('../components/canvas/left-toolbar.tsx')
  // Ensure we migrated placeholders to placeholder:opacity-40
  assert.match(src, /placeholder:opacity-40/)
  // Forbid the old pattern where opacity-40 applied to the entire input alongside placeholder text
  assert.doesNotMatch(src, /placeholder:text-\[var\(--sand-muted\)\] opacity-40/)
})

// New: Compact tool strip dividers inside sand scope should use the sand border var

test('left-toolbar maps compact divider bg-border to sand border var', () => {
  const src = read('../components/canvas/left-toolbar.tsx')
  assert.doesNotMatch(src, /bg-border/)
  assert.match(src, /bg-\[var\(--sand-border\)\]/)
})

// New: Jobs cancelled icon should use sand-muted instead of white/40

test('jobs-panel cancelled icon uses sand-muted token', () => {
  const src = read('../components/canvas/jobs-panel.tsx')
  // Ensure the cancelled branch uses sand-muted for the icon, but allow white/40 elsewhere (thumbnail placeholders)
  assert.doesNotMatch(src, /job\.status === 'cancelled'[\s\S]*text-white\/40/)
  assert.match(src, /job\.status === 'cancelled'[\s\S]*text-\[var\(--sand-muted\)\]/)
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
