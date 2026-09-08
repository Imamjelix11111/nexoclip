-- A prior unified queue can contain deliveries claimed before media queues were
-- separated. Re-publish queued jobs through their type-specific queues.
UPDATE generation_jobs
SET queue_published_at = NULL, queue_claimed_at = NULL, updated_at = now()
WHERE status = 'queued';
