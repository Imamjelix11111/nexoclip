const jobFields = `id, workspace_id, project_id, kind, status, model, estimated_cost,
  pricing_version_id, settlement_status, attempt_count, max_attempts, created_at,
  updated_at, started_at, finished_at`;
const usageFields = `id, workspace_id, generation_job_id, provider, provider_request_id,
  estimated_cost, actual_cost, units, created_at, updated_at`;
const creditFields = 'id, workspace_id, amount, balance_after, reason, idempotency_key, created_at';

function paging(filters = {}) {
  const page = Math.max(1, Math.min(100000, Number.parseInt(filters.page, 10) || 1));
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(filters.pageSize, 10) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

async function paged(pool, query, values, countQuery, countValues, page, pageSize) {
  const [data, count] = await Promise.all([pool.query(query, [...values, pageSize, (page - 1) * pageSize]), pool.query(countQuery, countValues)]);
  const total = Number(count.rows[0]?.count || 0);
  return { rows: data.rows, total };
}

export async function listGenerationJobs(pool, workspaceId, filters = {}) {
  const { page, pageSize, offset } = paging(filters);
  const values = [workspaceId];
  const conditions = ['workspace_id = $1'];
  if (filters.status) { values.push(filters.status); conditions.push(`status = $${values.length}`); }
  if (filters.model) { values.push(filters.model); conditions.push(`model = $${values.length}`); }
  const where = conditions.join(' AND ');
  return paged(pool, `SELECT ${jobFields} FROM generation_jobs WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, values, `SELECT COUNT(*) FROM generation_jobs WHERE ${where}`, values, page, pageSize);
}

export async function listProviderUsage(pool, workspaceId, filters = {}) {
  const { page, pageSize } = paging(filters);
  const values = [workspaceId];
  const conditions = ['workspace_id = $1'];
  if (filters.provider) { values.push(filters.provider); conditions.push(`provider = $${values.length}`); }
  const where = conditions.join(' AND ');
  return paged(pool, `SELECT ${usageFields} FROM provider_usage WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, values, `SELECT COUNT(*) FROM provider_usage WHERE ${where}`, values, page, pageSize);
}

export async function getCreditAudit(pool, workspaceId, filters = {}) {
  const { page, pageSize } = paging(filters);
  const values = [workspaceId];
  const conditions = ['workspace_id = $1'];
  if (filters.reason) { values.push(filters.reason); conditions.push(`reason = $${values.length}`); }
  const where = conditions.join(' AND ');
  const [account, ledger] = await Promise.all([
    pool.query('SELECT workspace_id, balance, updated_at FROM credit_accounts WHERE workspace_id = $1', [workspaceId]),
    paged(pool, `SELECT ${creditFields} FROM credit_ledger WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, values, `SELECT COUNT(*) FROM credit_ledger WHERE ${where}`, values, page, pageSize),
  ]);
  return { balance: account.rows[0] || { workspace_id: workspaceId, balance: '0' }, ...ledger };
}
