import { transitionGeneration } from '../queue/generationStateMachine.js';

function fence({ attempt, claimToken }) {
  if (!Number.isInteger(Number(attempt)) || !claimToken) throw new TypeError('attempt and claimToken are required');
  return [Number(attempt), claimToken];
}

export async function transitionGenerationJob(pool, { workspaceId, generationId, from, to, timeoutAt = null, attempt, claimToken }) {
  transitionGeneration(from, to);
  const [claimedAttempt, token] = fence({ attempt, claimToken });
  const result = await pool.query(
    `UPDATE generation_jobs
     SET status = $4, timeout_at = $5, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND status = $3
       AND attempt_count = $6 AND claim_token = $7
     RETURNING id, workspace_id, status, attempt_count, max_attempts, next_attempt_at, timeout_at`,
    [workspaceId, generationId, from, to, timeoutAt, claimedAttempt, token],
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
       FOR UPDATE SKIP LOCKED`, [now],
    );
    const recovered = [];
    for (const job of expired.rows) {
      const exhausted = Number(job.attempt_count) >= Number(job.max_attempts);
      await client.query(
        exhausted
          ? `UPDATE generation_jobs SET status = 'failed', error = '{"code":"GENERATION_LEASE_EXPIRED"}'::jsonb,
               timeout_at = NULL, claim_token = NULL, queue_published_at = NULL, queue_claimed_at = NULL, finished_at = now(), updated_at = now()
             WHERE id = $1 AND workspace_id = $2 AND attempt_count >= max_attempts`
          : `UPDATE generation_jobs SET status = 'queued', error = '{"code":"GENERATION_LEASE_EXPIRED","retryable":true}'::jsonb,
               timeout_at = NULL, claim_token = NULL, queue_published_at = NULL, queue_claimed_at = NULL, next_attempt_at = now(), updated_at = now()
             WHERE id = $1 AND workspace_id = $2`,
        [job.id, job.workspace_id],
      );
      recovered.push({id: job.id, workspaceId: job.workspace_id, status: exhausted ? 'failed' : 'queued', reservationLedgerId: job.reservation_ledger_id});
    }
    await client.query('COMMIT');
    return recovered;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function completeGenerationJob(pool, { workspaceId, generationId, provider, result = {}, attempt, claimToken }) {
  const [claimedAttempt, token] = fence({ attempt, claimToken });
  const updated = await pool.query(
    `UPDATE generation_jobs
     SET result = $3::jsonb, provider = COALESCE($4, provider), updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND status = 'running'
       AND attempt_count = $5 AND claim_token = $6
     RETURNING id, workspace_id, status, result, provider, provider_request_id`,
    [workspaceId, generationId, JSON.stringify(result || {}), provider || null, claimedAttempt, token],
  );
  return updated.rows[0] || null;
}

export async function retryGenerationJob(pool, { workspaceId, generationId, attempt, claimToken, nextAttemptAt, error }) {
  const [claimedAttempt, token] = fence({ attempt, claimToken });
  const result = await pool.query(
    `UPDATE generation_jobs SET status = 'queued', next_attempt_at = $3, error = $4::jsonb,
         timeout_at = NULL, claim_token = NULL, queue_published_at = NULL, queue_claimed_at = NULL, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND status IN ('running', 'processing')
       AND attempt_count = $5 AND claim_token = $6 AND attempt_count < max_attempts
     RETURNING id, workspace_id, status, attempt_count, max_attempts, next_attempt_at`,
    [workspaceId, generationId, nextAttemptAt, JSON.stringify(error || {}), claimedAttempt, token],
  );
  return result.rows[0] || null;
}

export async function recordGenerationProgress(pool, { workspaceId, generationId, progress, attempt, claimToken }) {
  const [claimedAttempt, token] = fence({ attempt, claimToken });
  const result = await pool.query(
    `UPDATE generation_jobs SET progress = $3::jsonb, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND status IN ('running', 'processing')
       AND attempt_count = $4 AND claim_token = $5
     RETURNING id, workspace_id, status, progress`,
    [workspaceId, generationId, JSON.stringify(progress || {}), claimedAttempt, token],
  );
  return result.rows[0] || null;
}

export async function recordGenerationProgressById(pool, { generationId, progress, attempt, claimToken }) {
  const [claimedAttempt, token] = fence({ attempt, claimToken });
  const result = await pool.query(
    `UPDATE generation_jobs SET progress = $2::jsonb, updated_at = now()
     WHERE id = $1 AND status IN ('running', 'processing') AND attempt_count = $3 AND claim_token = $4
     RETURNING id, workspace_id, status, progress`,
    [generationId, JSON.stringify(progress || {}), claimedAttempt, token],
  );
  return result.rows[0] || null;
}

export async function failGenerationJob(pool, { workspaceId, generationId, error, attempt, claimToken }) {
  const [claimedAttempt, token] = fence({ attempt, claimToken });
  const result = await pool.query(
    `UPDATE generation_jobs SET status = 'failed', error = $3::jsonb, finished_at = now(), timeout_at = NULL, claim_token = NULL, updated_at = now()
     WHERE workspace_id = $1 AND id = $2 AND status IN ('running', 'processing')
       AND attempt_count = $4 AND claim_token = $5
     RETURNING id, workspace_id, status, attempt_count, max_attempts`,
    [workspaceId, generationId, JSON.stringify(error || {}), claimedAttempt, token],
  );
  return result.rows[0] || null;
}
