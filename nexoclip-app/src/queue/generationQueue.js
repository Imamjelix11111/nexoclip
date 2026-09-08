const DEFAULT_BATCH_SIZE = 50;
const CLAIM_LEASE = "interval '5 minutes'";
const QUEUE_KINDS = new Set(['image', 'video', 'vimax']);
const JOB_KINDS = {
  image: ['image'],
  video: ['video'],
  vimax: ['vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video'],
};

export function generationQueueName(kind) {
  if (!QUEUE_KINDS.has(kind)) throw new Error('Unsupported generation queue kind');
  return `generation-${kind}`;
}

function messageFor(job) {
  const attempt = Number(job.attempt_count || 0) + 1;
  return {
    type: 'generation',
    generationId: job.id,
    workspaceId: job.workspace_id,
    attempt,
  };
}

async function claimQueued(client, limit, kind) {
  const result = await client.query(
    `UPDATE generation_jobs
     SET queue_claimed_at = now(), updated_at = now()
     WHERE id IN (
       SELECT id FROM generation_jobs
       WHERE status = 'queued'
         AND kind = ANY($2)
         AND queue_published_at IS NULL
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         AND (queue_claimed_at IS NULL OR queue_claimed_at < now() - ${CLAIM_LEASE})
       ORDER BY created_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     RETURNING id, workspace_id, status, attempt_count`,
    [limit, JOB_KINDS[kind]],
  );
  return result.rows;
}

async function markPublished(pool, generationId, attempt) {
  const result = await pool.query(
    `UPDATE generation_jobs
     SET queue_published_at = now(), queue_claimed_at = NULL, updated_at = now()
     WHERE id = $1 AND attempt_count = $2 AND status = 'queued' AND queue_published_at IS NULL
     RETURNING id`,
    [generationId, attempt],
  );
  return result.rows[0] || null;
}

async function releaseClaim(pool, generationId) {
  await pool.query(
    `UPDATE generation_jobs
     SET queue_claimed_at = NULL, updated_at = now()
     WHERE id = $1 AND status = 'queued' AND queue_published_at IS NULL`,
    [generationId],
  );
}

export function createQueuePublisher({ pool, queue, kind = 'image', batchSize = DEFAULT_BATCH_SIZE }) {
  if (!pool || !queue?.enqueue) throw new TypeError('pool and queue.enqueue are required');
  generationQueueName(kind);

  return {
    async publishAvailable() {
      const client = await pool.connect();
      let jobs;
      try {
        await client.query('BEGIN');
        jobs = await claimQueued(client, batchSize, kind);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      let published = 0;
      for (const job of jobs) {
        try {
          const message = messageFor(job);
          const delivery = await queue.enqueue(message, { idempotencyKey: `generation:${job.id}:attempt:${message.attempt}` });
          if (!delivery?.runnable) throw new Error('Generation queue did not create a runnable delivery');
          if (await markPublished(pool, job.id, job.attempt_count)) published += 1;
        } catch (error) {
          await releaseClaim(pool, job.id);
          throw error;
        }
      }
      return published;
    },
  };
}

export async function recoverQueuedGenerations(options) {
  return createQueuePublisher(options).publishAvailable();
}
