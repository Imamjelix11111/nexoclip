function filters({ workspaceId, userId, scope, periodStart = null }) {
  const values = [workspaceId];
  const conditions = ['gj.workspace_id = $1'];
  if (scope === 'me') {
    values.push(userId);
    conditions.push(`gj.created_by_user_id = $${values.length}`);
  }
  if (periodStart) {
    values.push(periodStart);
    conditions.push(`gj.created_at >= $${values.length}`);
  }
  return { values, where: conditions.join(' AND ') };
}

export const CREDIT_CHARGE_SQL = `CASE
  WHEN gj.settlement_status IN ('released', 'refunded') THEN 0::numeric
  WHEN gj.settlement_status = 'captured' THEN GREATEST(
    0::numeric,
    -COALESCE(reservation.amount, -gj.estimated_cost, 0::numeric)
      - COALESCE(adjustments.amount, 0::numeric)
  )
  ELSE COALESCE(gj.estimated_cost, 0::numeric)
END`;

const usageJoin = `
  LEFT JOIN credit_ledger reservation ON reservation.workspace_id = gj.workspace_id
    AND reservation.id = gj.reservation_ledger_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(entry.amount), 0::numeric) AS amount
    FROM credit_ledger entry
    WHERE entry.workspace_id = gj.workspace_id
      AND entry.reason = 'generation_capture'
      AND entry.metadata->>'generationId' = gj.id::text
  ) adjustments ON true
  LEFT JOIN LATERAL (
    SELECT provider, units
    FROM provider_usage
    WHERE workspace_id = gj.workspace_id AND generation_job_id = gj.id
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  ) pu ON true`;

export async function getUsageBalance(pool, workspaceId) {
  const result = await pool.query(
    `SELECT balance FROM credit_accounts WHERE workspace_id = $1 LIMIT 1`,
    [workspaceId],
  );
  return result.rows[0] || { balance: '0' };
}

export async function getUsageSummary(pool, input) {
  const { values, where } = filters(input);
  const result = await pool.query(
    `SELECT COALESCE(SUM(${CREDIT_CHARGE_SQL}), 0::numeric) AS credits_used,
            COUNT(*)::text AS generation_count
     FROM generation_jobs gj
     ${usageJoin}
     WHERE ${where}`,
    values,
  );
  return result.rows[0] || { credits_used: '0', generation_count: '0' };
}

export async function listUsageHistory(pool, { workspaceId, userId, scope, page, pageSize }) {
  const { values, where } = filters({ workspaceId, userId, scope });
  const offset = (page - 1) * pageSize;
  const data = await pool.query(
    `SELECT gj.id, gj.created_at, gj.kind, gj.prompt, gj.model, gj.status, pu.provider,
            ${CREDIT_CHARGE_SQL} AS credits,
            (gj.settlement_status = 'pending') AS estimated,
            COALESCE(pu.units, '{}'::jsonb) AS units
     FROM generation_jobs gj
     ${usageJoin}
     WHERE ${where}
     ORDER BY gj.created_at DESC, gj.id DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset],
  );
  const count = await pool.query(`SELECT COUNT(*)::text AS count FROM generation_jobs gj WHERE ${where}`, values);
  return { rows: data.rows, total: Number(count.rows[0]?.count || 0) };
}
