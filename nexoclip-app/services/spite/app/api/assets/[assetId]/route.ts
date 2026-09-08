import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'

import { getDb } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  assetNotFoundResponse,
  findOwnedGenerationAsset,
  unauthorizedResponse,
} from '@/lib/project-ownership'
import { getR2Client } from '@/lib/r2-upload'

function assetKeyFromUrl(url: string | null): string | null {
  if (!url) return null

  const proxyMatch = url.match(/\/api\/r2-image\/(.+)$/)
  if (proxyMatch) return proxyMatch[1] ?? null

  const uploadsMatch = url.match(/\/uploads\/[^/?#]+$/)
  if (uploadsMatch) return uploadsMatch[0].slice(1)

  return null
}

interface AssetRouteDeps {
  getDb?: typeof getDb
  getAuthenticatedUser?: typeof getAuthenticatedUser
  getR2Client?: typeof getR2Client
}

export function createAssetRouteHandlers(deps: AssetRouteDeps = {}) {
  const db = deps.getDb ?? getDb
  const resolveUser = deps.getAuthenticatedUser ?? getAuthenticatedUser
  const r2Client = deps.getR2Client ?? getR2Client

  return {
    async GET(
      request: Request,
      { params }: { params: Promise<{ assetId: string }> },
    ) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = db()
        const { assetId } = await params
        const asset = await findOwnedGenerationAsset(sql, user.id, assetId)
        if (!asset) return assetNotFoundResponse()

        return NextResponse.json(asset)
      } catch (error) {
        console.error('[assets] Fetch error:', error)
        return NextResponse.json({ error: 'Failed to fetch asset' }, { status: 500 })
      }
    },

    async PATCH(
      request: Request,
      { params }: { params: Promise<{ assetId: string }> },
    ) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = db()
        const { assetId } = await params
        const asset = await findOwnedGenerationAsset(sql, user.id, assetId)
        if (!asset) return assetNotFoundResponse()

        const body = await request.json()
        const { used_in_canvas, recovered } = body as {
          used_in_canvas?: boolean
          recovered?: boolean
        }

        if (used_in_canvas !== undefined) {
          const isProtected = used_in_canvas ?? true
          const expiresAt = isProtected ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          await sql`
            UPDATE generation_history
            SET used_in_canvas = ${isProtected}, expires_at = ${expiresAt}
            WHERE id = ${assetId} AND project_id = ${asset.project_id}
          `
        }

        if (recovered !== undefined) {
          await sql`ALTER TABLE generation_history ADD COLUMN IF NOT EXISTS recovered boolean DEFAULT false`
          await sql`
            UPDATE generation_history
            SET recovered = ${recovered}
            WHERE id = ${assetId} AND project_id = ${asset.project_id}
          `
        }

        return NextResponse.json({ success: true })
      } catch (error) {
        console.error('[assets] Update error:', error)
        return NextResponse.json({ error: 'Failed to update asset' }, { status: 500 })
      }
    },

    async DELETE(
      request: Request,
      { params }: { params: Promise<{ assetId: string }> },
    ) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = db()
        const { assetId } = await params
        const asset = await findOwnedGenerationAsset(sql, user.id, assetId)
        if (!asset) {
          return assetNotFoundResponse()
        }

        const removedRows = await sql`
          DELETE FROM asset_folder_items WHERE asset_id = ${assetId}
          RETURNING folder_id
        ` as { folder_id: string }[]
        const removedFromFolders = removedRows.length

        const canvasRefs = asset.r2_url
          ? await sql`
              SELECT 1 FROM canvas_nodes
              WHERE projectId = ${asset.project_id}
                AND (
                  data->>'assetId' = ${assetId}
                  OR data->>'outputUrl' = ${asset.r2_url}
                  OR data->>'thumbnail' = ${asset.r2_url}
                )
              LIMIT 1
            `
          : await sql`
              SELECT 1 FROM canvas_nodes
              WHERE projectId = ${asset.project_id}
                AND data->>'assetId' = ${assetId}
              LIMIT 1
            `

        if (canvasRefs.length > 0) {
          await sql`
            UPDATE generation_history
            SET used_in_canvas = true, expires_at = NULL
            WHERE id = ${assetId} AND project_id = ${asset.project_id}
          `
          return NextResponse.json({
            success: true,
            kept: true,
            reason: 'still_on_canvas',
            removed_from_folders: removedFromFolders,
          })
        }

        await sql`DELETE FROM generation_history WHERE id = ${assetId} AND project_id = ${asset.project_id}`

        const key = assetKeyFromUrl(asset.r2_url)
        if (key) {
          try {
            await r2Client().send(
              new DeleteObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME!,
                Key: key,
              })
            )
          } catch (r2Error) {
            console.error('[assets] R2 deletion failed:', r2Error)
          }
        }

        return NextResponse.json({
          success: true,
          kept: false,
          removed_from_folders: removedFromFolders,
        })
      } catch (error: any) {
        console.error('[assets] Delete error:', error)
        return NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 })
      }
    },
  }
}

const handlers = createAssetRouteHandlers()

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  return handlers.GET(request, context)
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  return handlers.PATCH(request, context)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ assetId: string }> },
) {
  return handlers.DELETE(request, context)
}
