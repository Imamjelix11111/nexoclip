import { getPool, closePool } from '../src/db/pool.js';
import { recoverQueuedGenerations } from '../src/queue/generationQueue.js';

// Queue adapters are deployment-specific. Inject one in the worker process; this
// command intentionally fails closed until the external queue is configured.
const queue = globalThis.nexoclipQueue;

if (!queue?.enqueue) {
  console.error('QUEUE_RECOVERY_UNCONFIGURED: configure the worker queue adapter before recovery.');
  process.exitCode = 1;
} else {
  try {
    const published = await recoverQueuedGenerations({ pool: getPool(), queue });
    console.log(`Recovered ${published} queued generation(s).`);
  } catch (error) {
    console.error(`Queue recovery failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
