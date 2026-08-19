// nexoclip-app/tests/db/unifiedJobsMigration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../src/db/migrations/020_unified_jobs.sql', import.meta.url), 'utf8');

test('kind check includes every feature kind', () => {
  for (const kind of ['image', 'video', 'clipping', 'audio', 'workflow_node',
    'vimax_narrative_planning', 'vimax_novel_planning', 'vimax_render_video']) {
    assert.match(sql, new RegExp(`'${kind.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}'`));
  }
});

test('prompt and model are made nullable', () => {
  assert.match(sql, /ALTER COLUMN prompt DROP NOT NULL/i);
  assert.match(sql, /ALTER COLUMN model DROP NOT NULL/i);
});
