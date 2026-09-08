import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('makes queued jobs eligible for their new media queue', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/023_split_media_queues.sql', import.meta.url), 'utf8');
  assert.match(sql, /SET queue_published_at = NULL/);
  assert.match(sql, /WHERE status = 'queued'/);
});
