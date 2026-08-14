import { fileURLToPath } from 'node:url';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { getPool, closePool } from '../db/pool.js';
import { createBullMqGenerationQueue } from './bullmqGenerationQueue.js';
import { recoverQueuedGenerations } from './generationQueue.js';
import { createStoryboardRuntimeClient } from './storyboardRuntimeClient.js';
import { transitionGeneration, isRetryableFailure, retryDelayMs } from './generationStateMachine.js';
import { transitionGenerationJob, retryGenerationJob, failGenerationJob } from '../repositories/generationStateRepository.js';
import { captureGenerationCredits, releaseGenerationReservation } from '../services/generationCreditSettlementService.js';

const REQUIRED = ['REDIS_URL', 'VIMAX_RUNTIME_URL', 'VIMAX_RUNTIME_TOKEN'];

export function workerConfig(env = process.env) {
  for (const key of REQUIRED) if (!env[key]) throw new Error(`${key} is required`);
  const concurrency = Number(env.STORYBOARD_WORKER_CONCURRENCY || 1);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('STORYBOARD_WORKER_CONCURRENCY must be an integer between 1 and 32');
  return { redisUrl: env.REDIS_URL, runtimeUrl: env.VIMAX_RUNTIME_URL, runtimeToken: env.VIMAX_RUNTIME_TOKEN, concurrency };
}

async function claimGeneration(pool, generationId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE generation_jobs SET status = 'running', attempt_count = attempt_count + 1, started_at = COALESCE(started_at, now()), updated_at = now()
       WHERE id = $1 AND status = 'queued'
         AND (NOT EXISTS (SELECT 1 FROM workspace_generation_limits l WHERE l.workspace_id = generation_jobs.workspace_id)
           OR (SELECT COUNT(*) FROM generation_jobs active WHERE active.workspace_id = generation_jobs.workspace_id AND active.status IN ('running', 'processing')) < (SELECT max_concurrent FROM workspace_generation_limits l WHERE l.workspace_id = generation_jobs.workspace_id))
       RETURNING id, workspace_id, kind, parameters, attempt_count, max_attempts, estimated_cost, reservation_ledger_id`,
      [generationId],
    );
    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

function createProcessor({ pool, runtimeClient, onError = console.error }) {
  return async (message) => {
    if (!message || message.type !== 'generation' || !message.generationId) return false;
    const job = await claimGeneration(pool, message.generationId);
    if (!job) return false;
    const workspaceId = job.workspace_id || message.workspaceId;
    try {
      const response = await runtimeClient.execute(job);
      if (!response?.ok) throw Object.assign(new Error('Storyboard runtime rejected generation'), { code: 'PROVIDER_UNAVAILABLE' });
      transitionGeneration('running', 'succeeded');
      if (job.reservation_ledger_id) await captureGenerationCredits(pool, { workspaceId, generationId: job.id, actualCost: job.estimated_cost ?? 0 });
      await transitionGenerationJob(pool, { workspaceId, generationId: job.id, from: 'running', to: 'succeeded' });
      return true;
    } catch (error) {
      const failure = { code: error.code || 'GENERATION_FAILED', retryable: isRetryableFailure(error) };
      const attempt = Number(job.attempt_count || 1);
      if (failure.retryable && attempt < Number(job.max_attempts || 3)) {
        await retryGenerationJob(pool, { workspaceId, generationId: job.id, attempt, nextAttemptAt: new Date(Date.now() + retryDelayMs(attempt)).toISOString(), error: failure });
      } else {
        await failGenerationJob(pool, { workspaceId, generationId: job.id, error: failure });
        if (job.reservation_ledger_id) await releaseGenerationReservation(pool, { workspaceId, generationId: job.id });
      }
      onError(error);
      return false;
    }
  };
}

export async function createStoryboardWorker({
  env = process.env, getPool: loadPool = getPool, closePool: closeDatabasePool = closePool,
  createQueue = createBullMqGenerationQueue, createRuntimeClient = createStoryboardRuntimeClient, Redis = IORedis,
  recoverQueuedGenerations: recover = recoverQueuedGenerations, setInterval: schedule = globalThis.setInterval,
  clearInterval: clearSchedule = globalThis.clearInterval, onError = console.error,
} = {}) {
  const config = workerConfig(env);
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const pool = loadPool();
  const queue = createQueue({ Queue, Worker, connection });
  const runtimeClient = createRuntimeClient({ baseUrl: config.runtimeUrl, token: config.runtimeToken });
  const recoverNow = () => recover({ pool, queue }).catch(onError);
  await recoverNow();
  const interval = schedule(recoverNow, 30_000);
  interval.unref?.();
  const worker = queue.createWorker(createProcessor({ pool, runtimeClient, onError }), { concurrency: config.concurrency });
  let closed = false;
  return {
    async close() {
      if (closed) return;
      closed = true;
      clearSchedule(interval);
      await worker.pause();
      await worker.close();
      await queue.close();
      await connection.quit();
      await closeDatabasePool();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const service = await createStoryboardWorker();
  const shutdown = async () => { await service.close(); process.exit(0); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
