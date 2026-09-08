import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'
import { ensureFoldersSchema } from '@/lib/folders-schema'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  projectNotFoundResponse,
  unauthorizedResponse,
  userOwnsProject,
} from '@/lib/project-ownership'

interface FoldersRouteDependencies {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
  createFolderId?: () => string
}

export function createFoldersRouteHandlers(dependencies: FoldersRouteDependencies = {}) {
  const getSql = dependencies.getDb ?? getDb
  const resolveUser = dependencies.getAuthenticatedUser ?? getAuthenticatedUser
  const createFolderId = dependencies.createFolderId ?? uuidv4

  return {
    async GET(request: NextRequest) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        await ensureFoldersSchema(sql)
        const { searchParams } = new URL(request.url)
        const projectId = searchParams.get('projectId')
        const type = searchParams.get('type')

        if (!projectId) return NextResponse.json([])
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const folders = type
          ? await sql`
              SELECT id, project_id, type, name, description, created_at, updated_at
              FROM asset_folders
              WHERE project_id = ${projectId} AND type = ${type}
              ORDER BY name ASC
            `
          : await sql`
              SELECT id, project_id, type, name, description, created_at, updated_at
              FROM asset_folders
              WHERE project_id = ${projectId}
              ORDER BY type, name ASC
            `

        if (folders.length === 0) {
          console.log('[folders] GET', { projectId, type, returned: 0 })
          return NextResponse.json([])
        }

        const folderIds = folders.map(f => String(f.id))
        const items = await sql`
          SELECT i.folder_id, i.asset_id, i.added_at,
                 g.r2_url, g.type AS asset_type, g.prompt
          FROM asset_folder_items i
          LEFT JOIN generation_history g ON g.id = i.asset_id
          WHERE i.folder_id = ANY(${folderIds}::text[])
          ORDER BY i.added_at DESC
        `

        const itemsByFolder = new Map<string, any[]>()
        for (const row of items) {
          const fid = String(row.folder_id)
          if (!itemsByFolder.has(fid)) itemsByFolder.set(fid, [])
          itemsByFolder.get(fid)!.push({
            id: row.asset_id,
            r2_url: row.r2_url,
            type: row.asset_type,
            prompt: row.prompt,
          })
        }

        const result = folders.map(f => ({
          ...f,
          assets: itemsByFolder.get(String(f.id)) || [],
        }))

        console.log('[folders] GET', { projectId, type, returned: result.length })
        return NextResponse.json(result)
      } catch (err: any) {
        console.error('[folders] GET error:', err)
        return NextResponse.json(
          { error: 'Failed to fetch folders' },
          { status: 500 },
        )
      }
    },

    async POST(request: NextRequest) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        await ensureFoldersSchema(sql)
        const { name, description, type, projectId, assetIds = [] } = await request.json()

        if (!name || !type) {
          return NextResponse.json({ error: 'name and type are required' }, { status: 400 })
        }
        if (!projectId) {
          return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
        }
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const id = createFolderId()
        console.log('[folders] POST creating', { id, name, type, projectId, assetCount: assetIds.length })

        await sql`
          INSERT INTO asset_folders (id, project_id, type, name, description)
          VALUES (${id}, ${projectId}, ${type}, ${name}, ${description || null})
        `

        for (const assetId of assetIds) {
          if (!assetId) continue
          await sql`
            INSERT INTO asset_folder_items (folder_id, asset_id)
            VALUES (${id}, ${assetId})
            ON CONFLICT (folder_id, asset_id) DO NOTHING
          `
          await sql`
            UPDATE generation_history
            SET used_in_canvas = true, expires_at = NULL
            WHERE id = ${assetId}
              AND project_id IN (SELECT id FROM projects WHERE userid = ${user.id})
          `
        }

        return NextResponse.json({ success: true, id })
      } catch (err: any) {
        console.error('[folders] POST error:', err)
        return NextResponse.json(
          { error: 'Failed to create folder' },
          { status: 500 },
        )
      }
    },
  }
}

const handlers = createFoldersRouteHandlers()

export const GET = handlers.GET
export const POST = handlers.POST
