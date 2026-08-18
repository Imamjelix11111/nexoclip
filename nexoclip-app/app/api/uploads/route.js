import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../src/lib/auth/session.js';
import { resolveTenantContext } from '../../../src/services/tenantContext.js';
import { persistUploadedAsset } from '../../../src/services/uploadedAssetService.js';
import { isBlockedFileType } from '../../../src/lib/uploadProxyTarget.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = Number(process.env.MAX_FILE_SIZE_MB || 500) * 1024 * 1024;

export async function POST(request) {
  let tenant;
  try {
    const workspaceId = request.headers.get('x-workspace-id');
    if (!workspaceId) return NextResponse.json({ error: 'x-workspace-id is required' }, { status: 400 });
    tenant = await resolveTenantContext({ token: request.cookies.get(SESSION_COOKIE)?.value, workspaceId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Authentication required' ? 401 : 403 });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (isBlockedFileType(file.name, file.type)) {
    return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const asset = await persistUploadedAsset({
      workspaceId: tenant.workspace.id,
      buffer,
      contentType: file.type || 'application/octet-stream',
      filename: file.name || 'upload',
    });
    return NextResponse.json({
      url: asset.url,
      id: asset.id,
      filename: asset.filename,
      contentType: asset.content_type,
      size: asset.size_bytes,
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return NextResponse.json({ error: error?.message || 'Upload failed' }, { status });
  }
}
