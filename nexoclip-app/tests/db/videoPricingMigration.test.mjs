import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('seeds a provisional durable video credit price', async () => {
  const sql = await readFile(new URL('../../src/db/migrations/022_video_generation_pricing.sql', import.meta.url), 'utf8');
  assert.match(sql, /'video_generation'/);
  assert.match(sql, /10\.000000/);
  assert.match(sql, /"provisional": true/);
});
