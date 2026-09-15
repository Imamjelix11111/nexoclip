import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { uploadedMediaLabel, folderMediaLabel } from '@/lib/canvas-media-label'

// Functional tests

test('uploadedMediaLabel preserves exact filename including extension', () => {
  assert.equal(uploadedMediaLabel('nathan-front.png'), 'nathan-front.png')
  assert.equal(uploadedMediaLabel('scene.final.v2.PNG'), 'scene.final.v2.PNG')
})

test('folderMediaLabel trims whitespace from folder names', () => {
  assert.equal(folderMediaLabel('  Nathan  '), 'Nathan')
})

// Source assertions

test('pasteImageFile uses uploadedMediaLabel(file.name) and records exact filename to assets', () => {
  const src = readFileSync(new URL('../components/canvas/canvas-workspace.tsx', import.meta.url), 'utf8')
  // Label uses uploadedMediaLabel
  assert.match(src, /const nodeLabel = uploadedMediaLabel\(file\.name\)/)
  // Asset registration keeps filename with extension (file.name)
  assert.match(src, /JSON\.stringify\(\{ url: proxyUrl, type: mediaType, filename: file\.name, projectId \}\)/)
})

test('ImageNode handles onAdded by persisting folder.name via folderMediaLabel and sync-guard', () => {
  const src = readFileSync(new URL('../components/canvas/nodes/image-node.tsx', import.meta.url), 'utf8')
  // Passes onAdded callback to AddToFolderModal
  assert.match(src, /<AddToFolderModal[\s\S]*onAdded=\{/)
  // Callback uses sync guard and folderMediaLabel to persist label
  assert.match(src, /onAdded=\{\(folder\) => \{[\s\S]*beginUserEdit\(\)[\s\S]*patchPersistedNodeData\(\{ label: folderMediaLabel\(folder\.name\) \}\)/)
})
