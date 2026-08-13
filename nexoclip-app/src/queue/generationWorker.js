import { transitionGeneration, isRetryableFailure, retryDelayMs } from './generationStateMachine.js';
import { captureGenerationCredits, releaseGenerationReservation } from '../services/generationCreditSettlementService.js';
import { transitionGenerationJob, retryGenerationJob, failGenerationJob } from '../repositories/generationStateRepository.js';

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;

async function claimGeneration(pool, generationId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE generation_jobs
       SET status = 'running', attempt_count = attempt_count + 1,
           started_at = COALESCE(started_at, now()), updated_at = now()
       WHERE id = $1 AND status = 'queued'
         AND (NOT EXISTS (SELECT 1 FROM workspace_generation_limits l WHERE l.workspace_id = generation_jobs.workspace_id)
           OR (SELECT COUNT(*) FROM generation_jobs active
               WHERE active.workspace_id = generation_jobs.workspace_id
                 AND active.status IN ('running', 'processing')) <
              (SELECT max_concurrent FROM workspace_generation_limits l WHERE l.workspace_id = generation_jobs.workspace_id))
       RETURNING id, workspace_id, project_id, kind, status, prompt, model, parameters,
                 estimated_cost, pricing_version_id, reservation_ledger_id, created_at,
                 updated_at, started_at`,
      [generationId],
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createGenerationWorker({
  pool,
  queue,
  handler,
  concurrency = DEFAULT_CONCURRENCY,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  onError = () => {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  baseDelayMs = 1000,
  maxDelayMs = 60000,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  persistResult = null,
  provider = 'muapi',
  settleCredits = true,
}) {
  if (!pool || !queue?.dequeue || typeof handler !== 'function') {
    throw new TypeError('pool, queue.dequeue, and handler are required');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('concurrency must be positive');

  let stopped = false;
  let active = new Set();

  async function process(message) {
    if (!message || message.type !== 'generation' || !message.generationId) return false;
    const job = await claimGeneration(pool, message.generationId);
    if (!job) return false;
    const workspaceId = job.workspace_id || message.workspaceId;
    const attempt = Number(job.attempt_count || 1);
    const limit = Number(job.max_attempts || maxAttempts);
    try {
      let timeout;
      const timedHandler = Promise.resolve().then(() => handler(job, message));
      const timedOut = new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Object.assign(new Error('Generation timed out'), { code: 'GENERATION_TIMEOUT' })), timeoutMs);
        timeout.unref?.();
      });
      const result = await Promise.race([timedHandler, timedOut]);
      clearTimeout(timeout);
      const nextStatus = result?.status || 'succeeded';
      if (nextStatus === 'succeeded' && persistResult && result.providerRequestId) {
        await persistResult({
          workspaceId,
          generationId: job.id,
          provider: result.provider || job.provider || provider,
          providerRequestId: result.providerRequestId,
          estimatedCost: job.estimated_cost ?? null,
          outputs: result.outputs || [],
          usage: result.usage || {},
        });
      }
      transitionGeneration('running', nextStatus);
      if (nextStatus === 'succeeded' && settleCredits && job.reservation_ledger_id) {
        await captureGenerationCredits(pool, { workspaceId, generationId: job.id, actualCost: result.usage?.cost ?? job.estimated_cost ?? 0 });
      }
      if (nextStatus === 'processing') {
        await transitionGenerationJob(pool, { workspaceId, generationId: job.id, from: 'running', to: 'processing' });
      } else {
        await transitionGenerationJob(pool, { workspaceId, generationId: job.id, from: 'running', to: 'succeeded' });
      }
      return true;
    } catch (error) {
      const failure = { code: error.code || 'GENERATION_FAILED', retryable: isRetryableFailure(error) };
      if (failure.retryable && attempt < limit) {
        const delay = retryDelayMs(attempt, { baseDelayMs, maxDelayMs });
        await retryGenerationJob(pool, {
          workspaceId, generationId: job.id, attempt, nextAttemptAt: new Date(Date.now() + delay).toISOString(), error: failure,
        });
      } else {
        await failGenerationJob(pool, { workspaceId, generationId: job.id, error: failure });
        if (settleCredits && job.reservation_ledger_id) await releaseGenerationReservation(pool, { workspaceId, generationId: job.id });
      }
      onError(error, job);
      return false;
    }
  }

  return {
    stop() { stopped = true; },

    async run({ maxMessages = Infinity } = {}) {
      let received = 0;
      while (!stopped && received < maxMessages) {
        while (!stopped && active.size < concurrency && received < maxMessages) {
          const message = await queue.dequeue();
          if (!message) break;
          received += 1;
          const task = process(message).catch(onError).finally(() => active.delete(task));
          active.add(task);
        }

        if (active.size) await Promise.race(active);
        else if (!stopped && received < maxMessages) await sleep(pollIntervalMs);
      }
      await Promise.all(active);
    },
  };
}

export { claimGeneration };
