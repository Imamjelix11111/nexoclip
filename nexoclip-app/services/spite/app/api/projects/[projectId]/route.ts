import { getDb } from '@/lib/db'
import { getR2Client } from '@/lib/r2-upload'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  projectNotFoundResponse,
  unauthorizedResponse,
  userOwnsProject,
} from '@/lib/project-ownership'
import { NextRequest, NextResponse } from 'next/server'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'

interface ProjectRouteDependencies {
  getDb?: typeof getDb
  getR2Client?: typeof getR2Client
  getAuthenticatedUser?: typeof getAuthenticatedUser
}

function keyFromUrl(url: string): string | null {
  const proxy = url.match(/\/api\/r2-image\/(.+)$/)
  if (proxy) return proxy[1]
  const uploads = url.match(/\/uploads\/[^/]+$/)
  if (uploads) return uploads[0].slice(1)
  return null
}

async function deleteR2Key(key: string, getClient: typeof getR2Client) {
  try {
    const client = getClient()
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    }))
  } catch (err) {
    console.error('[projects] R2 delete failed for', key, err)
  }
}

export function createProjectRouteHandlers(dependencies: ProjectRouteDependencies = {}) {
  const getSql = dependencies.getDb ?? getDb
  const getClient = dependencies.getR2Client ?? getR2Client
  const resolveUser = dependencies.getAuthenticatedUser ?? getAuthenticatedUser

  return {
    async GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        const { projectId } = await params
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const result = await sql`
          SELECT id, name, description, thumbnail, createdAt, updatedAt
          FROM projects
          WHERE id = ${projectId} AND userid = ${user.id}
        `

        if (result.length === 0) {
          return projectNotFoundResponse()
        }

        return NextResponse.json(result[0])
      } catch (error) {
        console.error('Error fetching project:', error)
        return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 })
      }
    },

    async PUT(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        const { projectId } = await params
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const { name, description, thumbnail } = await request.json()

        const result = await sql`
          UPDATE projects
          SET name = ${name}, description = ${description || ''}, thumbnail = ${thumbnail || null}, updatedAt = NOW()
          WHERE id = ${projectId} AND userid = ${user.id}
          RETURNING id, name, description, thumbnail, createdAt, updatedAt
        `

        if (result.length === 0) {
          return projectNotFoundResponse()
        }

        return NextResponse.json(result[0])
      } catch (error) {
        console.error('Error updating project:', error)
        return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
      }
    },

    async DELETE(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        const { projectId } = await params
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const assets = await sql`
          SELECT id, r2_url
          FROM generation_history
          WHERE project_id = ${projectId}
        ` as { id: string; r2_url: string | null }[]

        const exclusiveAssetIds: string[] = []
        const exclusiveKeys: string[] = []

        for (const asset of assets) {
          const url = asset.r2_url
          if (!url) {
            exclusiveAssetIds.push(asset.id)
            continue
          }
          const referrer = await sql`
            SELECT projectid
            FROM canvas_nodes
            WHERE projectid <> ${projectId}::text
              AND (data->>'outputUrl' = ${url} OR data->>'thumbnail' = ${url})
            LIMIT 1
          ` as { projectid: string }[]

          if (referrer.length === 0) {
            const key = keyFromUrl(url)
            if (key) exclusiveKeys.push(key)
            exclusiveAssetIds.push(asset.id)
          } else {
            await sql`
              UPDATE generation_history
              SET project_id = ${referrer[0].projectid}
              WHERE id = ${asset.id}
            `
          }
        }

        await Promise.all(exclusiveKeys.map((key) => deleteR2Key(key, getClient)))

        if (exclusiveAssetIds.length) {
          await sql`
            DELETE FROM generation_history
            WHERE id = ANY(${exclusiveAssetIds}::text[])
          `
        }

        const uploadRows = await sql`
          SELECT id, url FROM assets WHERE projectid = ${projectId}
        ` as { id: string; url: string | null }[]

        const uploadKeys: string[] = []
        for (const row of uploadRows) {
          const url = row.url
          if (!url) continue
          const referrer = await sql`
            SELECT projectid
            FROM canvas_nodes
            WHERE projectid <> ${projectId}::text
              AND (data->>'outputUrl' = ${url} OR data->>'thumbnail' = ${url})
            LIMIT 1
          ` as { projectid: string }[]
          if (referrer.length === 0) {
            const key = keyFromUrl(url)
            if (key) uploadKeys.push(key)
          }
        }
        await Promise.all(uploadKeys.map((key) => deleteR2Key(key, getClient)))

        await sql`DELETE FROM asset_folder_items WHERE folder_id IN (SELECT id FROM asset_folders WHERE project_id = ${projectId})`
        await sql`DELETE FROM asset_folders WHERE project_id = ${projectId}`
        await sql`DELETE FROM assets WHERE projectid = ${projectId}`
        await sql`DELETE FROM canvas_edges WHERE projectid = ${projectId}::text`
        await sql`DELETE FROM canvas_nodes WHERE projectid = ${projectId}::text`
        await sql`DELETE FROM projects WHERE id = ${projectId} AND userid = ${user.id}`

        return NextResponse.json({
          success: true,
          assetsDeleted: exclusiveAssetIds.length,
          assetsTransferred: assets.length - exclusiveAssetIds.length,
          uploadFilesDeleted: uploadKeys.length,
        })
      } catch (error) {
        console.error('Error deleting project:', error)
        return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
      }
    },
  }
}

const handlers = createProjectRouteHandlers()

export const GET = handlers.GET
export const PUT = handlers.PUT
export const DELETE = handlers.DELETE
