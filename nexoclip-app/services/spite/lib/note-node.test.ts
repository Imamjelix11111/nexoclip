import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const wsPath = join(process.cwd(), 'components/canvas/canvas-workspace.tsx')
const tbPath = join(process.cwd(), 'components/canvas/left-toolbar.tsx')
const nnPath = join(process.cwd(), 'components/canvas/nodes/note-node.tsx')

function safeRead(p: string): string {
  try {
    if (!existsSync(p)) return ''
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

test('Note node is registered, tool exists, and component meets boundaries', () => {
  const workspaceSource = safeRead(wsPath)
  const toolbarSource = safeRead(tbPath)
  const noteSource = safeRead(nnPath)

  assert.match(workspaceSource, /note:\s*NoteNode/)
  assert.match(workspaceSource, /activeTool === 'note'/)
  assert.match(toolbarSource, /id: 'note'/)
  assert.match(noteSource, /ResizableNodeFrame/)
  assert.match(noteSource, /patchNodeData\(id, \{ text:/)
  assert.match(noteSource, /aria-label="Note text"/)
  assert.doesNotMatch(noteSource, /<Handle/)
})
