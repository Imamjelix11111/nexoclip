import { fileURLToPath } from 'node:url';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { getPool, closePool } from '../db/pool.js';
import { createBullMqGenerationQueue } from './bullmqGenerationQueue.js';
import { recoverQueuedGenerations } from './generationQueue.js';
import { createStoryboardRuntimeClient } from './storyboardRuntimeClient.js';
import { createGenerationProcessor } from './generationWorker.js';

const REQUIRED = ['REDIS_URL', 'VIMAX_RUNTIME_URL', 'VIMAX_RUNTIME_TOKEN'];

export function workerConfig(env = process.env) {
  for (const key of REQUIRED) if (!env[key]) throw new Error(`${key} is required`);
  const concurrency = Number(env.STORYBOARD_WORKER_CONCURRENCY || 1);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('STORYBOARD_WORKER_CONCURRENCY must be an integer between 1 and 32');
  return { redisUrl: env.REDIS_URL, runtimeUrl: env.VIMAX_RUNTIME_URL, runtimeToken: env.VIMAX_RUNTIME_TOKEN, concurrency };
}

export function createStoryboardProcessor({ pool, runtimeClient, onError = console.error, ...options }) {
  return createGenerationProcessor({
    pool,
    handler: async (job) => {
      const response = await runtimeClient.execute(job);
      if (!response?.ok) throw Object.assign(new Error('Storyboard runtime rejected generation'), { code: 'PROVIDER_UNAVAILABLE' });
      return { status: 'succeeded' };
    },
    onError,
    ...options,
  });
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
  const worker = queue.createWorker(createStoryboardProcessor({ pool, runtimeClient, onError }), { concurrency: config.concurrency });
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
