export async function findUserByEmail(client, email) {
  const result = await client.query(
    `SELECT id, email, password_hash, display_name
     FROM users
     WHERE lower(email) = lower($1)
     LIMIT 1`,
    [email],
  );
  return result.rows[0] || null;
}

export async function createUserWithWorkspace(client, {
  email,
  passwordHash,
  displayName,
  workspaceName,
  workspaceSlug,
}) {
  const userResult = await client.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, email, display_name`,
    [email, passwordHash, displayName],
  );
  const user = userResult.rows[0];

  const workspaceResult = await client.query(
    `INSERT INTO workspaces (name, slug)
     VALUES ($1, $2)
     RETURNING id, name, slug`,
    [workspaceName, workspaceSlug],
  );
  const workspace = workspaceResult.rows[0];

  await client.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [workspace.id, user.id],
  );

  return { user, workspace };
}
