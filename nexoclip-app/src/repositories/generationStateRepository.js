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
