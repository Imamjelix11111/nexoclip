export async function lockGenerationForSettlement(client, workspaceId, generationId) {
  const result = await client.query(
    `SELECT id, workspace_id, status, settlement_status, estimated_cost, reservation_ledger_id
     FROM generation_jobs WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [workspaceId, generationId],
  );
  return result.rows[0] || null;
}

export async function settleUnreservedGeneration(client, workspaceId, generationId, status) {
  const settlementStatus = status === 'succeeded' ? 'captured' : status === 'failed' ? 'released' : null;
  if (!settlementStatus) throw new TypeError('Unreserved generation must be terminal');
  const result = await client.query(
    `UPDATE generation_jobs SET settlement_status = $4, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND settlement_status = 'pending'
       AND reservation_ledger_id IS NULL AND status = $3
     RETURNING id, workspace_id, status, settlement_status, estimated_cost, reservation_ledger_id`,
    [workspaceId, generationId, status, settlementStatus],
  );
  return result.rows[0] || null;
}

export async function updateGenerationSettlement(client, workspaceId, generationId, from, to) {
  const result = await client.query(
    `UPDATE generation_jobs SET settlement_status = $4, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND settlement_status = $3
     RETURNING id, workspace_id, status, settlement_status, estimated_cost, reservation_ledger_id`,
    [workspaceId, generationId, from, to],
  );
  return result.rows[0] || null;
}
