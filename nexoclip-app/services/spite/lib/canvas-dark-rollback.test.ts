import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const toolbar = read('../components/canvas/left-toolbar.tsx')
const workspace = read('../components/canvas/canvas-workspace.tsx')
const mention = read('../components/canvas/mention-textarea.tsx')

test('dark controls remove Sand and Notes while preserving current features', () => {
  assert.doesNotMatch(toolbar, /--sand-/)
  assert.doesNotMatch(toolbar, /id:\s*'note'/)
  assert.doesNotMatch(workspace, /NoteNode|activeTool === 'note'|note:\s*NoteNode/)
  assert.equal(existsSync(new URL('../components/canvas/nodes/note-node.tsx', import.meta.url)), false)
  assert.match(workspace, /uploadedMediaLabel\(file\.name\)/)
  assert.match(mention, /placeMentionMenu/)
})
