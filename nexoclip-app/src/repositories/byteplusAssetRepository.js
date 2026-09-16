const columns = `id, workspace_id, local_asset_id, group_id, provider_asset_id,
  status, error, project_name, created_at, updated_at`;

export async function findBytePlusAssetLink(client, workspaceId, localAssetId) {
  const result = await client.query(
    `SELECT ${columns}
     FROM byteplus_asset_links
     WHERE workspace_id = $1 AND local_asset_id = $2
     LIMIT 1`,
    [workspaceId, localAssetId],
  );
  return result.rows[0] || null;
}

export async function createProcessingBytePlusAssetLink(client, {
  workspaceId, localAssetId, projectName = 'default',
}) {
  const result = await client.query(
    `INSERT INTO byteplus_asset_links (workspace_id, local_asset_id, status, project_name)
     VALUES ($1, $2, 'processing', $3)
     ON CONFLICT (workspace_id, local_asset_id) DO NOTHING
     RETURNING ${columns}`,
    [workspaceId, localAssetId, projectName],
  );
  return result.rows[0] || findBytePlusAssetLink(client, workspaceId, localAssetId);
}

export async function updateBytePlusAssetLink(client, {
  workspaceId, localAssetId, groupId, providerAssetId, status, error,
}) {
  const result = await client.query(
    `UPDATE byteplus_asset_links
     SET group_id = COALESCE($3, group_id),
         provider_asset_id = COALESCE($4, provider_asset_id),
         status = $5, error = $6::jsonb, updated_at = now()
     WHERE workspace_id = $1 AND local_asset_id = $2
     RETURNING ${columns}`,
    [workspaceId, localAssetId, groupId, providerAssetId, status, error && JSON.stringify(error)],
  );
  return result.rows[0] || null;
}

export async function compareAndSetBytePlusAssetLinkStatus(client, {
  workspaceId, localAssetId, expectedStatus, expectedProviderAssetId, status, error,
}) {
  const result = await client.query(
    `UPDATE byteplus_asset_links
     SET status = $5, error = $6::jsonb, updated_at = now()
     WHERE workspace_id = $1 AND local_asset_id = $2
       AND status = $3 AND provider_asset_id IS NOT DISTINCT FROM $4
     RETURNING ${columns}`,
    [workspaceId, localAssetId, expectedStatus, expectedProviderAssetId, status, error && JSON.stringify(error)],
  );
  return result.rows[0] || null;
}

export async function resetBytePlusAssetLink(client, workspaceId, localAssetId) {
  const result = await client.query(
    `UPDATE byteplus_asset_links
     SET group_id = NULL, provider_asset_id = NULL, status = 'processing', error = NULL, updated_at = now()
     WHERE workspace_id = $1 AND local_asset_id = $2
     RETURNING ${columns}`,
    [workspaceId, localAssetId],
  );
  return result.rows[0] || null;
}
