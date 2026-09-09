import assert from 'node:assert/strict'
import test from 'node:test'

import { createCanvasRouteHandlers } from '../app/api/projects/[projectId]/canvas/route'
import { createCanvasSnapshotRouteHandlers } from '../app/api/projects/[projectId]/canvas/snapshots/route'

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

function createSqlStub(respond: (normalized: string) => unknown) {
  const calls: string[] = []
  const sql = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const normalized = strings.join(' ? ').replace(/\s+/g, ' ').trim().toLowerCase()
    calls.push(normalized)
    return respond(normalized)
  }) as any
  sql.calls = calls
  sql.transaction = async () => {
    throw new Error('legacy canvas route must not open SQL transactions in this test')
  }
  return sql as ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>) & {
    calls: string[]
    transaction: (...args: unknown[]) => Promise<never>
  }
}

test('canvas GET returns projection compatibility payload marked with projection source in body and header', async () => {
  const sql = createSqlStub((normalized) => {
    if (normalized.includes('select 1 from projects where id = ? and userid = ? limit 1')) {
      return [{ ok: 1 }]
    }

    if (normalized.startsWith('alter table projects add column if not exists scenes jsonb')) {
      return []
    }

    if (normalized.startsWith('alter table projects add column if not exists active_scene_id text')) {
      return []
    }

    if (normalized.includes('select nodeid as id, type, position_x, position_y, data from canvas_nodes')) {
      return [{
        id: 'node-1',
        type: 'prompt',
        position_x: 11,
        position_y: 22,
        data: { label: 'hello' },
      }]
    }

    if (normalized.includes('select edgeid as id, source, target, sourcehandle, targethandle, animated, data from canvas_edges')) {
      return [{
        id: 'edge-1',
        source: 'node-1',
        target: 'node-1',
        sourcehandle: 'out',
        targethandle: 'in',
        animated: false,
        data: {},
      }]
    }

    if (normalized.startsWith('select scenes, active_scene_id from projects where id = ?')) {
      return [{
        scenes: [{ id: 'scene-1', name: 'Scene 1' }],
        active_scene_id: 'scene-1',
      }]
    }

    throw new Error(`Unhandled SQL in canvas GET test: ${normalized}`)
  })

  const handlers = createCanvasRouteHandlers({
    getDb: () => sql as any,
    getAuthenticatedUser: async () => ({ id: OWNER_ID }),
  })

  const response = await handlers.GET(makeRequest(`http://spite.local/api/projects/${PROJECT_ID}/canvas`) as any, {
    params: Promise.resolve({ projectId: PROJECT_ID }),
  } as any)

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('X-Canvas-Source'), 'projection')
  assert.deepEqual(await response.json(), {
    nodes: [{
      id: 'node-1',
      type: 'prompt',
      position: { x: 11, y: 22 },
      data: { label: 'hello' },
    }],
    edges: [{
      id: 'edge-1',
      source: 'node-1',
      target: 'node-1',
      sourceHandle: 'out',
      targetHandle: 'in',
      animated: false,
      data: {},
    }],
    scenes: [{ id: 'scene-1', name: 'Scene 1' }],
    activeSceneId: 'scene-1',
    source: 'projection',
  })
})

test('legacy canvas POST returns 410 Gone after ownership validation without parsing the body or writing projection tables', async () => {
  const sql = createSqlStub((normalized) => {
    if (normalized.includes('select 1 from projects where id = ? and userid = ? limit 1')) {
      return [{ ok: 1 }]
    }

    throw new Error(`Unexpected SQL in legacy canvas POST test: ${normalized}`)
  })

  const handlers = createCanvasRouteHandlers({
    getDb: () => sql as any,
    getAuthenticatedUser: async () => ({ id: OWNER_ID }),
  })

  let parsedBody = false
  const request = new Request(`http://spite.local/api/projects/${PROJECT_ID}/canvas`, {
    method: 'POST',
  })
  Object.defineProperty(request, 'json', {
    value: async () => {
      parsedBody = true
      throw new Error('legacy POST should not parse the body')
    },
  })

  const response = await handlers.POST(request, {
    params: Promise.resolve({ projectId: PROJECT_ID }),
  } as any)

  assert.equal(response.status, 410)
  assert.equal(parsedBody, false)
  assert.deepEqual(sql.calls, [
    'select 1 from projects where id = ? and userid = ? limit 1',
  ])
  assert.deepEqual(await response.json(), {
    error: 'Canvas save endpoint is gone; use realtime sync',
  })
})

test('snapshot restore stays on snapshot bookkeeping plus authoritative realtime replace without direct projection SQL writes', async () => {
  const sql = createSqlStub((normalized) => {
    if (normalized.includes('select 1 from projects where id = ? and userid = ? limit 1')) {
      return [{ ok: 1 }]
    }

    if (normalized.includes('canvas_nodes') || normalized.includes('canvas_edges')) {
      throw new Error(`snapshot restore must not touch projection tables: ${normalized}`)
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

    throw new Error(`Unhandled SQL in snapshot restore contract test: ${normalized}`)
  })

  const replaceCalls: unknown[] = []
  const handlers = createCanvasSnapshotRouteHandlers({
    getDb: () => sql as any,
    getAuthenticatedUser: async () => ({ id: OWNER_ID }),
    createInternalRealtimeClient: () => ({
      exportDocument: async () => ({
        durableSeq: 4,
        projectedSeq: 4,
        projection: {
          nodes: [{ id: 'current-node', type: 'prompt', position: { x: 0, y: 0 }, data: { label: 'current' } }],
          edges: [],
          scenes: [{ id: 'scene-1', name: 'Scene 1' }],
          activeSceneId: 'scene-1',
        },
      }),
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
