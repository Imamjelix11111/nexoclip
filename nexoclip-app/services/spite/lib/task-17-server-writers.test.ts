import assert from 'node:assert/strict'
import test from 'node:test'

import { createAssetRouteHandlers } from '../app/api/assets/[assetId]/route'
import { createGenerateRecoverHandler } from '../app/api/generate/recover/route'
import { createDuplicateProjectHandler } from '../app/api/projects/[projectId]/duplicate/route'
import { createCanvasSnapshotRouteHandlers } from '../app/api/projects/[projectId]/canvas/snapshots/route'
import { createAttachGeneratedMediaToNode } from './r2-upload'

const OWNER_ID = '550e8400-e29b-41d4-a716-446655440001'
const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'
const SNAPSHOT_ID = '550e8400-e29b-41d4-a716-446655440099'

function makeRequest(url: string, {
  method = 'GET',
  body,
}: {
  method?: string
  body?: unknown
} = {}) {
  const headers: Record<string, string> = {}
  let payload: string | undefined
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const request = new Request(url, { method, headers, body: payload }) as Request & { nextUrl?: URL }
  request.nextUrl = new URL(url)
  return request
}

test('attachGeneratedMediaToNode routes generation completion through authoritative realtime patching', async () => {
  const calls: unknown[] = []
  const attach = createAttachGeneratedMediaToNode({
    createInternalRealtimeClient: () => ({
      patchNodeData: async (input: unknown) => {
        calls.push(input)
      },
    }) as any,
  })

  await attach({
    userId: OWNER_ID,
    projectId: PROJECT_ID,
    nodeId: 'node-1',
    url: '/uploads/generated.png',
  })

  assert.deepEqual(calls, [{
    userId: OWNER_ID,
    projectId: PROJECT_ID,
    nodeId: 'node-1',
    set: {
      outputUrl: '/uploads/generated.png',
      status: 'completed',
      error: null,
    },
    unset: ['pendingRequestId', 'pendingProvider', 'pendingProviderModel', 'pendingFalEndpoint', 'pendingStartedAt'],
  }])
})

test('snapshot restore routes through authoritative realtime document replacement', async () => {
  const replaceCalls: unknown[] = []
  const exportCalls: unknown[] = []
  const handlers = createCanvasSnapshotRouteHandlers({
    getDb: () => (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const normalized = strings.join(' ? ').replace(/\s+/g, ' ').trim().toLowerCase()

      if (normalized.includes('select 1 from projects where id = ? and userid = ? limit 1')) {
        return [{ ok: 1 }]
      }

      if (normalized.includes('select id, nodes_json, edges_json from canvas_snapshots where project_id = ? and id = ?') && normalized.includes('limit 1')) {
        return [{
          id: SNAPSHOT_ID,
          nodes_json: [{ id: 'restored-node', type: 'imageGen', position: { x: 10, y: 20 }, data: { label: 'restored' } }],
          edges_json: [{ id: 'edge-1', source: 'restored-node', target: 'restored-node', data: {} }],
        }]
      }

      if (normalized.startsWith('insert into canvas_snapshots')) {
        return []
      }

      if (normalized.startsWith('delete from canvas_snapshots')) {
        return []
      }

      throw new Error(`Unhandled SQL in snapshot restore test: ${normalized}`)
    }) as any,
    getAuthenticatedUser: async () => ({ id: OWNER_ID }),
    createInternalRealtimeClient: () => ({
      exportDocument: async (input: unknown) => {
        exportCalls.push(input)
        return {
          durableSeq: 4,
          projectedSeq: 4,
          projection: {
            nodes: [{ id: 'current-node', type: 'prompt', position: { x: 0, y: 0 }, data: { label: 'current' } }],
            edges: [],
            scenes: [{ id: 'scene-1', name: 'Scene 1' }],
            activeSceneId: 'scene-1',
          },
        }
      },
      replaceDocument: async (input: unknown) => {
        replaceCalls.push(input)
      },
    }) as any,
  })

  const response = await handlers.POST(makeRequest(`http://spite.local/api/projects/${PROJECT_ID}/canvas/snapshots`, {
    method: 'POST',
    body: { snapshotId: SNAPSHOT_ID },
  }) as any, { params: Promise.resolve({ projectId: PROJECT_ID }) } as any)

  assert.equal(response.status, 200)
  assert.deepEqual(exportCalls, [{ userId: OWNER_ID, projectId: PROJECT_ID }])
  assert.deepEqual(replaceCalls, [{
    userId: OWNER_ID,
    projectId: PROJECT_ID,
    projection: {
      nodes: [{ id: 'restored-node', type: 'imageGen', position: { x: 10, y: 20 }, data: { label: 'restored' } }],
      edges: [{ id: 'edge-1', source: 'restored-node', target: 'restored-node', data: {} }],
      scenes: [{ id: 'scene-1', name: 'Scene 1' }],
      activeSceneId: 'scene-1',
    },
  }])
})

test('duplicate project clones authoritative document instead of copying projection tables directly', async () => {
  const exportCalls: unknown[] = []
  const replaceCalls: unknown[] = []
  const handler = createDuplicateProjectHandler({
    getDb: () => (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const normalized = strings.join(' ? ').replace(/\s+/g, ' ').trim().toLowerCase()

      if (normalized.includes('select 1 from projects where id = ? and userid = ? limit 1')) {
        return [{ ok: 1 }]
      }

      if (normalized.startsWith("select name, description, thumbnail, coalesce(origin, 'canvas') as origin from projects where id = ?")) {
        return [{ name: 'Storyboard', description: '', thumbnail: null, origin: 'canvas' }]
      }

      if (normalized.startsWith('insert into projects')) {
        return [{ id: 'copy-project', name: 'Storyboard (Copy)' }]
      }

      throw new Error(`Unhandled SQL in duplicate test: ${normalized}`)
    }) as any,
    getAuthenticatedUser: async () => ({ id: OWNER_ID }),
    createProjectId: () => 'copy-project',
    createInternalRealtimeClient: () => ({
      exportDocument: async (input: unknown) => {
        exportCalls.push(input)
        return {
          durableSeq: 9,
          projectedSeq: 9,
          projection: {
            nodes: [{ id: 'source-node', type: 'prompt', position: { x: 1, y: 2 }, data: { label: 'hello' } }],
            edges: [],
            scenes: [{ id: 'scene-1', name: 'Scene 1' }],
            activeSceneId: 'scene-1',
          },
        }
      },
      replaceDocument: async (input: unknown) => {
        replaceCalls.push(input)
      },
    }) as any,
  })

  const response = await handler(makeRequest(`http://spite.local/api/projects/${PROJECT_ID}/duplicate`, {
    method: 'POST',
  }) as any, { params: Promise.resolve({ projectId: PROJECT_ID }) } as any)

  assert.equal(response.status, 200)
  assert.deepEqual(exportCalls, [{ userId: OWNER_ID, projectId: PROJECT_ID }])
  assert.deepEqual(replaceCalls, [{
    userId: OWNER_ID,
    projectId: 'copy-project',
    projection: {
      nodes: [{ id: 'source-node', type: 'prompt', position: { x: 1, y: 2 }, data: { label: 'hello' } }],
      edges: [],
      scenes: [{ id: 'scene-1', name: 'Scene 1' }],
      activeSceneId: 'scene-1',
    },
  }])
})

test('generate/recover bulk cleanup clears pending markers via authoritative realtime patching', async () => {
  const patchCalls: unknown[] = []
  const handler = createGenerateRecoverHandler({
    getDb: () => (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const normalized = strings.join(' ? ').replace(/\s+/g, ' ').trim().toLowerCase()

      if (normalized.includes('select 1 from projects where id = ? and userid = ? limit 1')) {
        return [{ ok: 1 }]
      }

      if (normalized.includes('select projectid, nodeid, data, type from canvas_nodes where projectid = ?') && normalized.includes("data->>'pendingrequestid' is not null") && normalized.includes("data->>'pendingfalendpoint' is not null")) {
        return [{
          projectid: PROJECT_ID,
          nodeid: 'node-1',
          type: 'imageGen',
          data: {
            pendingRequestId: 'req-123',
            pendingFalEndpoint: 'fal-ai/flux/dev',
            prompt: 'recover me',
          },
        }]
      }

      throw new Error(`Unhandled SQL in generate/recover task 17 test: ${normalized}`)
    }) as any,
    getAuthenticatedUser: async () => ({ id: OWNER_ID }),
    falKey: 'test-fal-key',
    fetchFalStatus: async () => Response.json({ status: 'FAILED' }),
    fetchFalResult: async () => Response.json({}),
    createInternalRealtimeClient: () => ({
      patchNodeData: async (input: unknown) => {
        patchCalls.push(input)
      },
    }) as any,
  })

  const response = await handler(makeRequest('http://spite.local/api/generate/recover', {
    method: 'POST',
    body: { projectId: PROJECT_ID },
  }) as any)

  assert.equal(response.status, 200)
  assert.deepEqual(patchCalls, [{
    userId: OWNER_ID,
    projectId: PROJECT_ID,
    nodeId: 'node-1',
    unset: ['pendingRequestId', 'pendingFalEndpoint', 'pendingStartedAt'],
  }])
})

test('asset delete consults authoritative document when projection lags before removing media', async () => {
  const exportCalls: unknown[] = []
  const handlers = createAssetRouteHandlers({
    getDb: () => (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const normalized = strings.join(' ? ').replace(/\s+/g, ' ').trim().toLowerCase()

      if (normalized.startsWith('select g.id, g.project_id, g.r2_url from generation_history g join projects p on p.id = g.project_id where p.userid = ? and g.id = ? limit 1')) {
        return [{ id: 'asset-1', project_id: PROJECT_ID, r2_url: '/uploads/generated.png' }]
      }

      if (normalized.startsWith('delete from asset_folder_items where asset_id = ? returning folder_id')) {
        return []
      }

      if (normalized.startsWith('select durable_seq, projected_seq from canvas_yjs_documents where project_id = ?')) {
        return [{ durable_seq: 7, projected_seq: 6 }]
      }

      if (normalized.startsWith('update generation_history set used_in_canvas = true, expires_at = null where id = ? and project_id = ?') || normalized.startsWith('update generation_history set used_in_canvas = ?, expires_at = ? where id = ? and project_id = ?')) {
        return []
      }

      throw new Error(`Unhandled SQL in asset delete lag test: ${normalized}`)
    }) as any,
    getAuthenticatedUser: async () => ({ id: OWNER_ID }),
    getR2Client: () => ({ send: async () => { throw new Error('R2 delete should not run when authoritative doc still references asset') } }) as any,
    createInternalRealtimeClient: () => ({
      exportDocument: async (input: unknown) => {
        exportCalls.push(input)
        return {
          durableSeq: 7,
          projectedSeq: 6,
          projection: {
            nodes: [{
              id: 'node-1',
              type: 'imageGen',
              position: { x: 0, y: 0 },
              data: {
                assetId: 'asset-1',
                outputUrl: '/uploads/generated.png',
              },
            }],
            edges: [],
            scenes: [{ id: 'scene-1', name: 'Scene 1' }],
            activeSceneId: 'scene-1',
          },
        }
      },
    }) as any,
  })

  const response = await handlers.DELETE(makeRequest('http://spite.local/api/assets/asset-1', {
    method: 'DELETE',
  }) as any, { params: Promise.resolve({ assetId: 'asset-1' }) } as any)

  assert.equal(response.status, 200)
  assert.deepEqual(exportCalls, [{ userId: OWNER_ID, projectId: PROJECT_ID }])
  assert.deepEqual(await response.json(), {
    success: true,
    kept: true,
    reason: 'still_on_canvas',
    removed_from_folders: 0,
  })
})
