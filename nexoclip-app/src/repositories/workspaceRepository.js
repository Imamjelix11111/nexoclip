export async function listUserWorkspaces(client, userId) {
  const result = await client.query(
    `SELECT w.id, w.name, w.slug, wm.role
     FROM workspace_memberships wm
     JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id = $1
     ORDER BY w.created_at ASC`,
    [userId],
  );

  return result.rows;
}

export async function findWorkspaceMembership(client, workspaceId, userId) {
  const result = await client.query(
    `SELECT w.id, w.name, w.slug, wm.user_id, wm.role
     FROM workspace_memberships wm
     JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.workspace_id = $1 AND wm.user_id = $2
     LIMIT 1`,
    [workspaceId, userId],
  );

  return result.rows[0] || null;
}
