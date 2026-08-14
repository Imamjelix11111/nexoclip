import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { closePool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';
import { createVimaxGenerationJobWithReservation } from '../../src/services/generationService.js';

const DATABASE_URL = process.env.NEXOCLIP_TEST_DATABASE_URL;

test('admits a zero-cost ViMax job without a ledger entry', { skip: !DATABASE_URL && 'NEXOCLIP_TEST_DATABASE_URL is required (dedicated test database)' }, async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = DATABASE_URL;
  const admin = new pg.Pool({ connectionString: DATABASE_URL });
  const workspaceId = '00000000-0000-0000-0000-000000000018';
  try {
    await migrate();
    await admin.query(`INSERT INTO workspaces (id, name, slug) VALUES ($1, 'ViMax admission test', 'vimax-admission-test') ON CONFLICT (id) DO NOTHING`, [workspaceId]);
    const job = await createVimaxGenerationJobWithReservation(admin, workspaceId, {
      kind: 'vimax_render_video', sessionId: 'session-1', input: {}, idempotencyKey: 'vimax-zero-cost',
    });
    assert.equal(job.status, 'queued');
    assert.equal(job.reservation_ledger_id, null);
    assert.equal(job.settlement_status, 'pending');
    const ledger = await admin.query('SELECT count(*)::integer AS count FROM credit_ledger WHERE workspace_id = $1', [workspaceId]);
    assert.equal(ledger.rows[0].count, 0);
  } finally {
    await closePool();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await admin.end();
  }
});
