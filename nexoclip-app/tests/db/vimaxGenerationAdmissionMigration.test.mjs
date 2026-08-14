import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../../src/db/migrations/018_vimax_generation_admission.sql', import.meta.url);

test('allows explicit ViMax generation kinds and seeds configurable zero-credit operations', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const kind of ['vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video']) {
    assert.match(sql, new RegExp(kind));
  }
  for (const operation of ['vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video']) {
    assert.match(sql, new RegExp(`'${operation}'.*0\\.000000`));
  }
});
