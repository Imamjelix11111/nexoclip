export async function createGeneratedAsset(client, {
  workspaceId, storageKey, filename, contentType, sizeBytes,
}) {
  const result = await client.query(
    `INSERT INTO assets (workspace_id, storage_key, filename, content_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, workspace_id, storage_key, filename, content_type, size_bytes, created_at`,
    [workspaceId, storageKey, filename, contentType, sizeBytes],
  );
  return result.rows[0];
}

export async function listAssets(client, workspaceId) {
  const result = await client.query(
    `SELECT id, workspace_id, storage_key, filename, content_type, size_bytes, created_at
     FROM assets
     WHERE workspace_id = $1
     ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows;
}
