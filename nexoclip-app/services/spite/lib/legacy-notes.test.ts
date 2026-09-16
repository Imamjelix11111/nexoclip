import assert from 'node:assert/strict'
import test from 'node:test'
import { selectLegacyNoteDeletionIds, type MinimalNode } from './legacy-notes'

test('selectLegacyNoteDeletionIds picks only note types, once per id', () => {
  const scheduled = new Set<string>()
  const nodes: MinimalNode[] = [
    { id: 'a', type: 'note' },
    { id: 'b', type: 'imageGen' },
    { id: 'c', type: 'note' },
    { id: 'd', type: 'comment' },
    { id: 'e', type: undefined },
  ]

  // First pass: only note ids a and c
  const first = selectLegacyNoteDeletionIds(nodes, scheduled)
  assert.deepEqual(first.sort(), ['a', 'c'])
  assert.equal(scheduled.has('a') && scheduled.has('c'), true)

  // Second pass with same nodes: nothing new should be returned
  const second = selectLegacyNoteDeletionIds(nodes, scheduled)
  assert.deepEqual(second, [])

  // Third pass with a new legacy note and some non-notes
  const third = selectLegacyNoteDeletionIds([
    { id: 'x', type: 'note' },
    { id: 'a', type: 'note' }, // already scheduled
    { id: 'y', type: 'videoGen' },
  ], scheduled)
  assert.deepEqual(third, ['x'])
})
