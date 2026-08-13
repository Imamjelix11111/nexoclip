const accountColumns = 'workspace_id, balance, created_at, updated_at';
const ledgerColumns = 'id, workspace_id, amount, balance_after, reason, idempotency_key, metadata, created_at';

export async function createCreditAccount(client, workspaceId) {
  const result = await client.query(
    `INSERT INTO credit_accounts (workspace_id) VALUES ($1)
     ON CONFLICT (workspace_id) DO NOTHING
     RETURNING ${accountColumns}`,
    [workspaceId],
  );
  if (result.rows[0]) return result.rows[0];
  return lockCreditAccount(client, workspaceId);
}

export async function lockCreditAccount(client, workspaceId) {
  const result = await client.query(
    `SELECT ${accountColumns} FROM credit_accounts
     WHERE workspace_id = $1 FOR UPDATE`,
    [workspaceId],
  );
  return result.rows[0] || null;
}

export async function findCreditEntryByIdempotencyKey(client, workspaceId, idempotencyKey) {
  const result = await client.query(
    `SELECT ${ledgerColumns} FROM credit_ledger
     WHERE workspace_id = $1 AND idempotency_key = $2 LIMIT 1`,
    [workspaceId, idempotencyKey],
  );
  return result.rows[0] || null;
}

export async function insertCreditEntry(client, { workspaceId, amount, balanceAfter, reason, idempotencyKey, metadata = {} }) {
  const result = await client.query(
    `INSERT INTO credit_ledger
       (workspace_id, amount, balance_after, reason, idempotency_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING ${ledgerColumns}`,
    [workspaceId, amount, balanceAfter, reason, idempotencyKey, JSON.stringify(metadata)],
  );
  return result.rows[0];
}

export async function updateCreditBalance(client, workspaceId, balance) {
  const result = await client.query(
    `UPDATE credit_accounts SET balance = $2, updated_at = now()
     WHERE workspace_id = $1 RETURNING ${accountColumns}`,
    [workspaceId, balance],
  );
  return result.rows[0] || null;
}
