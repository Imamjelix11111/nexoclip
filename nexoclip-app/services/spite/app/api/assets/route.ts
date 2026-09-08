import { NextRequest, NextResponse } from 'next/server'
import { getR2Client } from '@/lib/r2-upload'
import { getDb } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  assetNotFoundResponse,
  projectNotFoundResponse,
  unauthorizedResponse,
  findOwnedGenerationAsset,
  userOwnsProject,
} from '@/lib/project-ownership'
import { v4 as uuidv4 } from 'uuid'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'

interface AssetsRouteDependencies {
  getDb?: typeof getDb
  getR2Client?: typeof getR2Client
  getAuthenticatedUser?: typeof getAuthenticatedUser
  createAssetId?: () => string
}

async function deleteFromR2(key: string, getClient: typeof getR2Client) {
  try {
    const s3Client = getClient()
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      }),
    )
  } catch (error) {
    console.error('[assets] R2 delete error:', error)
  }
}

let assetsSchemaReady = false
async function ensureAssetsSchema(sql: ReturnType<typeof getDb>) {
  if (assetsSchemaReady) return
  await sql`ALTER TABLE generation_history ADD COLUMN IF NOT EXISTS recovered boolean DEFAULT false`
  await sql`ALTER TABLE generation_history ADD COLUMN IF NOT EXISTS refs jsonb`
  await sql`CREATE INDEX IF NOT EXISTS idx_genhistory_project_created ON generation_history (project_id, created_at DESC)`
  assetsSchemaReady = true
}

export function createAssetsRouteHandlers(dependencies: AssetsRouteDependencies = {}) {
  const getSql = dependencies.getDb ?? getDb
  const getClient = dependencies.getR2Client ?? getR2Client
  const resolveUser = dependencies.getAuthenticatedUser ?? getAuthenticatedUser
  const createAssetId = dependencies.createAssetId ?? uuidv4

  return {
    async GET(request: NextRequest) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        const projectId = request.nextUrl.searchParams.get('projectId')
        await ensureAssetsSchema(sql)

        if (projectId) {
          if (!(await userOwnsProject(sql, user.id, projectId))) {
            return projectNotFoundResponse()
          }

          const assets = await sql`
            SELECT id, type, model, prompt, r2_url, used_in_canvas,
                   COALESCE(is_upload, false) as is_upload,
                   COALESCE(recovered, false) as recovered,
                   refs,
                   created_at
            FROM generation_history
            WHERE project_id = ${projectId}
              AND (used_in_canvas = true OR expires_at > CURRENT_TIMESTAMP OR expires_at IS NULL)
            ORDER BY created_at DESC
            LIMIT 500
          `
          return NextResponse.json(assets)
        }

        const assets = await sql`
          SELECT g.id, g.type, g.model, g.prompt, g.r2_url, g.used_in_canvas,
                 COALESCE(g.is_upload, false) as is_upload,
                 COALESCE(g.recovered, false) as recovered,
                 g.refs,
                 g.created_at
          FROM generation_history g
          JOIN projects p ON p.id = g.project_id
          WHERE p.userid = ${user.id}
            AND (g.used_in_canvas = true OR g.expires_at > CURRENT_TIMESTAMP OR g.expires_at IS NULL)
          ORDER BY g.created_at DESC
          LIMIT 500
        `
        return NextResponse.json(assets)
      } catch (error) {
        console.error('[assets] List error:', error)
        return NextResponse.json([], { status: 200 })
      }
    },

    async POST(request: NextRequest) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        const { url, type, filename, projectId } = await request.json()

        if (!url) {
          return NextResponse.json({ error: 'URL is required' }, { status: 400 })
        }

        if (!projectId) {
          return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
        }

        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const existing = await sql`
          SELECT id FROM generation_history WHERE r2_url = ${url} AND project_id = ${projectId} LIMIT 1
        `

        if (existing.length > 0) {
          await sql`
            UPDATE generation_history
            SET used_in_canvas = true, expires_at = NULL
            WHERE id = ${existing[0].id}
          `
          return NextResponse.json({ success: true, id: existing[0].id, reactivated: true })
        }

        const id = createAssetId()
        const result = await sql`
          INSERT INTO generation_history (id, type, model, prompt, r2_url, is_upload, used_in_canvas, expires_at, project_id)
          VALUES (${id}, ${type || 'image'}, 'upload', ${filename || 'User upload'}, ${url}, true, true, NULL, ${projectId})
          RETURNING id
        `

        return NextResponse.json({ success: true, id: result[0].id })
      } catch (error) {
        console.error('[assets] Upload record error:', error)
        return NextResponse.json({ error: 'Failed to record upload' }, { status: 500 })
      }
    },

    async PATCH(request: NextRequest) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        const { url, refs, projectId } = await request.json()
        if (!url || !Array.isArray(refs)) {
          return NextResponse.json({ error: 'url and refs[] are required' }, { status: 400 })
        }
        await ensureAssetsSchema(sql)
        const clean = refs.filter((u) => typeof u === 'string').slice(0, 12)

        if (projectId) {
          if (!(await userOwnsProject(sql, user.id, projectId))) {
            return projectNotFoundResponse()
          }

          await sql`
            UPDATE generation_history SET refs = ${JSON.stringify(clean)}::jsonb WHERE r2_url = ${url} AND project_id = ${projectId}
          `
        } else {
          await sql`
            UPDATE generation_history
            SET refs = ${JSON.stringify(clean)}::jsonb
            WHERE r2_url = ${url}
              AND project_id IN (SELECT id FROM projects WHERE userid = ${user.id})
          `
        }
        return NextResponse.json({ success: true })
      } catch (error) {
        console.error('[assets] Set refs error:', error)
        return NextResponse.json({ error: 'Failed to set refs' }, { status: 500 })
      }
    },

    async DELETE(request: NextRequest) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        const { id } = await request.json()

        if (!id) {
          return NextResponse.json({ error: 'Asset ID is required' }, { status: 400 })
        }

        const asset = await findOwnedGenerationAsset(sql, user.id, id)
        if (!asset) {
          return assetNotFoundResponse()
        }

        if (asset.r2_url) {
          const keyMatch = asset.r2_url.match(/\/uploads\/[^/]+$/) || asset.r2_url.match(/\/api\/r2-image\/(.+)$/)
          if (keyMatch) {
            const key = keyMatch[0].startsWith('/api') ? keyMatch[1] : keyMatch[0].slice(1)
            await deleteFromR2(key, getClient)
          }
        }

        await sql`DELETE FROM generation_history WHERE id = ${id} AND project_id = ${asset.project_id}`

        return NextResponse.json({ success: true })
      } catch (error) {
        console.error('[assets] Delete error:', error)
        return NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 })
      }
    },
  }
}

const handlers = createAssetsRouteHandlers()

export const GET = handlers.GET
export const POST = handlers.POST
export const PATCH = handlers.PATCH
export const DELETE = handlers.DELETE
