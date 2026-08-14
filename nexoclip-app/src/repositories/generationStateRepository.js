import { transitionGeneration } from '../queue/generationStateMachine.js';

export async function transitionGenerationJob(pool, { workspaceId, generationId, from, to, timeoutAt = null }) {
  transitionGeneration(from, to);
  const result = await pool.query(
    `UPDATE generation_jobs
     SET status = $4, timeout_at = $5, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND status = $3
     RETURNING id, workspace_id, status, attempt_count, max_attempts, next_attempt_at, timeout_at`,
    [workspaceId, generationId, from, to, timeoutAt],
  );
  return result.rows[0] || null;
}

export async function recoverExpiredGenerationJobs(pool, { now = new Date().toISOString() } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expired = await client.query(
      `SELECT id, workspace_id, attempt_count, max_attempts, reservation_ledger_id
       FROM generation_jobs
       WHERE status IN ('running', 'processing') AND timeout_at <= $1
       FOR UPDATE SKIP LOCKED`,
      [now],
    );
    const recovered = [];
    for (const job of expired.rows) {
      const exhausted = Number(job.attempt_count) >= Number(job.max_attempts);
      await client.query(
        exhausted
          ? `UPDATE generation_jobs SET status = 'failed', error = '{"code":"GENERATION_LEASE_EXPIRED"}'::jsonb,
               timeout_at = NULL, queue_published_at = NULL, queue_claimed_at = NULL, finished_at = now(), updated_at = now()
             WHERE id = $1 AND workspace_id = $2 AND attempt_count >= max_attempts`
          : `UPDATE generation_jobs SET status = 'queued', error = '{"code":"GENERATION_LEASE_EXPIRED","retryable":true}'::jsonb,
               timeout_at = NULL, queue_published_at = NULL, queue_claimed_at = NULL, next_attempt_at = now(), updated_at = now()
             WHERE id = $1 AND workspace_id = $2`,
        [job.id, job.workspace_id],
      );
      recovered.push({id: job.id, workspaceId: job.workspace_id, status: exhausted ? 'failed' : 'queued', reservationLedgerId: job.reservation_ledger_id});
    }
    await client.query('COMMIT');
    return recovered;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function completeGenerationJob(pool, { workspaceId, generationId, provider, providerRequestId = null, result = {} }) {
  const updated = await pool.query(
    `UPDATE generation_jobs
     SET result = $3::jsonb, provider = COALESCE($4, provider), provider_request_id = $5, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND status = 'running'
     RETURNING id, workspace_id, status, result, provider, provider_request_id`,
    [workspaceId, generationId, JSON.stringify(result || {}), provider || null, providerRequestId],
  );
  return updated.rows[0] || null;
}

export async function retryGenerationJob(pool, { workspaceId, generationId, attempt, nextAttemptAt, error }) {
  const result = await pool.query(
    `UPDATE generation_jobs
     SET status = 'queued', attempt_count = $3, next_attempt_at = $4,
         error = $5::jsonb, timeout_at = NULL, queue_published_at = NULL,
         queue_claimed_at = NULL, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND status IN ('running', 'processing')
       AND attempt_count < max_attempts
     RETURNING id, workspace_id, status, attempt_count, max_attempts, next_attempt_at`,
    [workspaceId, generationId, attempt, nextAttemptAt, JSON.stringify(error || {})],
  );
  return result.rows[0] || null;
}

export async function recordGenerationProgress(pool, { workspaceId, generationId, progress }) {
  const result = await pool.query(
    `UPDATE generation_jobs
     SET progress = $3::jsonb, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND status IN ('running', 'processing')
     RETURNING id, workspace_id, status, progress`,
    [workspaceId, generationId, JSON.stringify(progress || {})],
  );
  return result.rows[0] || null;
}

export async function recordGenerationProgressById(pool, { generationId, progress }) {
  const result = await pool.query(
    `UPDATE generation_jobs
     SET progress = $2::jsonb, updated_at = now()
     WHERE id = $1 AND status IN ('running', 'processing')
     RETURNING id, workspace_id, status, progress`,
    [generationId, JSON.stringify(progress || {})],
  );
  return result.rows[0] || null;
}

export async function failGenerationJob(pool, { workspaceId, generationId, error }) {
  const result = await pool.query(
    `UPDATE generation_jobs
     SET status = 'failed', error = $3::jsonb, finished_at = now(), timeout_at = NULL, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND status IN ('running', 'processing')
     RETURNING id, workspace_id, status, attempt_count, max_attempts`,
    [workspaceId, generationId, JSON.stringify(error || {})],
  );
  return result.rows[0] || null;
}
