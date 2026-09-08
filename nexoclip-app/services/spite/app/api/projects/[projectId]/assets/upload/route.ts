import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client } from '@/lib/r2-upload'
import { getDb } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/main-session'
import {
  projectNotFoundResponse,
  unauthorizedResponse,
  userOwnsProject,
} from '@/lib/project-ownership'
import { NextRequest, NextResponse } from 'next/server'
import { withBasePath } from '@/lib/base-path'

interface ProjectAssetUploadRouteDependencies {
  getDb?: typeof getDb
  getR2Client?: typeof getR2Client
  getAuthenticatedUser?: typeof getAuthenticatedUser
}

export function createProjectAssetUploadRouteHandlers(dependencies: ProjectAssetUploadRouteDependencies = {}) {
  const getSql = dependencies.getDb ?? getDb
  const getClient = dependencies.getR2Client ?? getR2Client
  const resolveUser = dependencies.getAuthenticatedUser ?? getAuthenticatedUser

  return {
    async POST(
      request: NextRequest,
      { params }: { params: Promise<{ projectId: string }> },
    ) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        const { projectId } = await params
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const formData = await request.formData()
        const file = formData.get('file') as File
        const name = formData.get('name') as string
        const category = formData.get('category') as string

        if (!file) {
          return NextResponse.json({ error: 'No file provided' }, { status: 400 })
        }

        const timestamp = Date.now()
        const filename = `${projectId}/${timestamp}-${file.name}`
        const buffer = await file.arrayBuffer()

        await getClient().send(
          new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME!,
            Key: filename,
            Body: new Uint8Array(buffer),
            ContentType: file.type,
          }),
        )

        const url = withBasePath(`/api/r2-image/${filename}`)
        const result = await sql`
          INSERT INTO assets (projectId, name, category, url, metadata)
          VALUES (${projectId}, ${name}, ${category}, ${url}, ${JSON.stringify({ filename, size: file.size, type: file.type })})
          RETURNING id, name, category, url, createdAt
        `

        return NextResponse.json(result[0], { status: 201 })
      } catch (error) {
        console.error('Upload error:', error)
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
      }
    },

    async DELETE(
      request: NextRequest,
      { params }: { params: Promise<{ projectId: string }> },
    ) {
      try {
        const user = await resolveUser(request)
        if (!user) return unauthorizedResponse()

        const sql = getSql()
        const { projectId } = await params
        if (!(await userOwnsProject(sql, user.id, projectId))) {
          return projectNotFoundResponse()
        }

        const { assetId, filename } = await request.json()

        await getClient().send(
          new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME!,
            Key: filename,
          }),
        )

        await sql`DELETE FROM assets WHERE id = ${assetId} AND projectId = ${projectId}`

        return NextResponse.json({ success: true })
      } catch (error) {
        console.error('Delete error:', error)
        return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
      }
    },
  }
}

const handlers = createProjectAssetUploadRouteHandlers()

export const POST = handlers.POST
export const DELETE = handlers.DELETE
