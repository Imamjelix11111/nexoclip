import assert from 'node:assert/strict'
import test from 'node:test'
import type { NodeChange } from '@xyflow/react'

import {
  filterSelectedNodeIdsToVisible,
  reconcileSelectedNodeIds,
} from './canvas-selection'

function selectChange(id: string, selected: boolean): NodeChange {
  return { id, type: 'select', selected } as NodeChange
}

test('reconcileSelectedNodeIds keeps identity for no-op select changes', () => {
  const previous = ['node-1']

  const next = reconcileSelectedNodeIds(previous, [selectChange('node-1', true)], new Set(['node-1', 'node-2']))

  assert.strictEqual(next, previous)
})

test('reconcileSelectedNodeIds returns new array when selection actually changes', () => {
  const previous = ['node-1']

  const next = reconcileSelectedNodeIds(previous, [selectChange('node-2', true)], new Set(['node-1', 'node-2']))

  assert.deepEqual(next, ['node-1', 'node-2'])
  assert.notStrictEqual(next, previous)
})

test('filterSelectedNodeIdsToVisible keeps identity when all selected ids are visible', () => {
  const previous = ['node-1', 'node-2']

  const next = filterSelectedNodeIdsToVisible(previous, new Set(['node-1', 'node-2', 'node-3']))

  assert.strictEqual(next, previous)
})

test('filterSelectedNodeIdsToVisible removes hidden ids', () => {
  const previous = ['node-1', 'node-2']

  const next = filterSelectedNodeIdsToVisible(previous, new Set(['node-1']))

  assert.deepEqual(next, ['node-1'])
  assert.notStrictEqual(next, previous)
})
