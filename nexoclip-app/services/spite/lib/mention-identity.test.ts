import assert from 'node:assert/strict'
import test from 'node:test'

import { compileMentionsForModel, type FolderType } from './mention-prompt'
import { getModelById } from './fal-models'

const model = getModelById('nano-banana-pro')

function compile(type: FolderType) {
  const name = type === 'character' ? 'Nathan' : type === 'prop' ? 'Hero Sword' : 'Jakarta Studio'
  return compileMentionsForModel(
    `Place @${name.replace(/\s+/g, '-')} in a new shot`,
    [{ folderId: `${type}-folder`, name, selectedAssetIds: [`${type}-asset`] }],
    [{
      id: `${type}-folder`, name, type,
      assets: [{ id: `${type}-asset`, r2_url: `/spite/api/r2-image/${type}.png` }],
    }],
    model,
  )
}

test('character mentions demand the exact same identity', () => {
  const result = compile('character')
  assert.equal(result.refGroups.length, 1)
  assert.match(result.prompt, /exact same person\/character/i)
  assert.match(result.prompt, /preserve facial identity, facial structure, skin tone, hairstyle, and distinguishing features/i)
})

test('prop mentions demand the exact same object', () => {
  const result = compile('prop')
  assert.match(result.prompt, /exact same object/i)
  assert.match(result.prompt, /preserve its shape, geometry, materials, colors, markings, and distinguishing details/i)
})

test('location mentions demand the exact same place', () => {
  const result = compile('location')
  assert.match(result.prompt, /exact same location/i)
  assert.match(result.prompt, /preserve its spatial layout, architecture, landmarks, materials, and distinguishing details/i)
})

test('multiple mentions preserve every reference group and slot order', () => {
  const result = compileMentionsForModel(
    'Put @Nathan with @Hero-Sword inside @Jakarta-Studio',
    [
      { folderId: 'character-folder', name: 'Nathan', selectedAssetIds: ['face-front', 'face-side'] },
      { folderId: 'prop-folder', name: 'Hero Sword', selectedAssetIds: ['sword'] },
      { folderId: 'location-folder', name: 'Jakarta Studio', selectedAssetIds: ['studio'] },
    ],
    [
      {
        id: 'character-folder', name: 'Nathan', type: 'character',
        assets: [
          { id: 'face-front', r2_url: '/spite/api/r2-image/face-front.png' },
          { id: 'face-side', r2_url: '/spite/api/r2-image/face-side.png' },
        ],
      },
      {
        id: 'prop-folder', name: 'Hero Sword', type: 'prop',
        assets: [{ id: 'sword', r2_url: '/spite/api/r2-image/sword.png' }],
      },
      {
        id: 'location-folder', name: 'Jakarta Studio', type: 'location',
        assets: [{ id: 'studio', r2_url: '/spite/api/r2-image/studio.png' }],
      },
    ],
    model,
  )

  assert.deepEqual(result.refGroups.map((group) => group.urls), [
    ['/spite/api/r2-image/face-front.png', '/spite/api/r2-image/face-side.png'],
    ['/spite/api/r2-image/sword.png'],
    ['/spite/api/r2-image/studio.png'],
  ])
  assert.match(result.prompt, /reference images 1-2/)
  assert.match(result.prompt, /reference image 3/)
  assert.match(result.prompt, /reference image 4/)
  assert.match(result.prompt, /exact same person\/character/)
  assert.match(result.prompt, /exact same object/)
  assert.match(result.prompt, /exact same location/)
})
