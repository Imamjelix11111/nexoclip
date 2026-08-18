export function bullMqJobId(idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || !idempotencyKey) throw new TypeError('idempotencyKey is required');
  return `id-${Buffer.from(idempotencyKey).toString('base64url')}`;
}

export function createBullMqGenerationQueue({ Queue, Worker, connection, queueName = 'generation' }) {
  if (!Queue || !Worker || !connection) throw new TypeError('Queue, Worker, and connection are required');

  const producer = new Queue(queueName, { connection });
  return {
    async enqueue(message, { idempotencyKey }) {
      const job = await producer.add('generation', message, {
        jobId: bullMqJobId(idempotencyKey),
        removeOnComplete: true,
        removeOnFail: false,
      });
      const state = await job.getState();
      return { runnable: !['failed', 'completed'].includes(state) };
    },

    createWorker(handler, options = {}) {
      if (typeof handler !== 'function') throw new TypeError('handler is required');
      return new Worker(queueName, (job) => handler(job.data), { connection, ...options });
    },

    async close() {
      await producer.close();
    },
  };
}
