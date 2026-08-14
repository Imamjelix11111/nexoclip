export function createBullMqGenerationQueue({ Queue, Worker, connection, queueName = 'generation' }) {
  if (!Queue || !Worker || !connection) throw new TypeError('Queue, Worker, and connection are required');

  const producer = new Queue(queueName, { connection });
  return {
    async enqueue(message, { idempotencyKey }) {
      try {
        await producer.add('generation', message, {
          jobId: idempotencyKey,
          removeOnComplete: true,
          removeOnFail: false,
        });
      } catch (error) {
        // BullMQ rejects a duplicate ID in some supported Redis/BullMQ combinations.
        // The existing job already represents this idempotent publication.
        if (!/job.*exist|exist.*job/i.test(error.message || '')) throw error;
      }
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
