const RETURN_COLS = 'id, workspace_id, kind, status, parameters, result, error, created_at, updated_at';

export async function insertJob(client, { workspaceId, kind, params }) {
  const result = await client.query(
    `INSERT INTO generation_jobs (workspace_id, kind, status, parameters)
     VALUES ($1, $2, 'queued', $3)
     RETURNING ${RETURN_COLS}`,
    [workspaceId, kind, params ?? {}],
  );
  return result.rows[0];
}

export async function findJob(client, workspaceId, id) {
  const result = await client.query(
    `SELECT ${RETURN_COLS} FROM generation_jobs
     WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
    [workspaceId, id],
  );
  return result.rows[0] || null;
}

export async function listJobs(client, { workspaceId, statuses = null, limit = 50 }) {
  if (statuses && statuses.length) {
    const result = await client.query(
      `SELECT ${RETURN_COLS} FROM generation_jobs
       WHERE workspace_id = $1 AND status = ANY($2)
       ORDER BY created_at DESC LIMIT $3`,
      [workspaceId, statuses, limit],
    );
    return result.rows;
  }
  const result = await client.query(
    `SELECT ${RETURN_COLS} FROM generation_jobs
     WHERE workspace_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [workspaceId, limit],
  );
  return result.rows;
}

export async function updateJob(client, { workspaceId, id, status, result = null, error = null }) {
  const res = await client.query(
    `UPDATE generation_jobs
     SET status = $3, result = $4, error = $5, updated_at = now()
     WHERE workspace_id = $1 AND id = $2
     RETURNING ${RETURN_COLS}`,
    [workspaceId, id, status, result, error],
  );
  return res.rows[0] || null;
}
