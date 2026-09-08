import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageService } from '../../src/services/usageService.js';

function repository(overrides = {}) {
  return {
    getUsageBalance: async () => ({ balance: '840.000000' }),
    getUsageSummary: async () => ({ credits_used: '160.000000', generation_count: '23' }),
    listUsageHistory: async () => ({ rows: [{ id: 'g1', created_at: new Date('2026-09-07T10:00:00Z'), credits: '8.000000', estimated: false, units: { images: 1 } }], total: 1 }),
    ...overrides,
  };
}

test('member receives only personal paginated usage', async () => {
  const calls = [];
  const service = createUsageService({ repository: repository({
    listUsageHistory: async (args) => { calls.push(args); return { rows: [], total: 0 }; },
  }), now: () => new Date('2026-09-07T12:00:00Z') });
  const data = await service.getUsage({ workspaceId: 'w1', userId: 'u1', role: 'member', scope: 'me', page: '2', pageSize: '500' });
  assert.equal(calls[0].scope, 'me');
  assert.equal(calls[0].userId, 'u1');
  assert.deepEqual(data.pagination, { page: 2, pageSize: 100, total: 0, totalPages: 0 });
  assert.deepEqual(data.permissions, { canViewWorkspace: false });
});

test('member cannot request workspace usage', async () => {
  const service = createUsageService({ repository: repository() });
  await assert.rejects(
    service.getUsage({ workspaceId: 'w1', userId: 'u1', role: 'member', scope: 'workspace' }),
    (error) => error.status === 403 && error.code === 'WORKSPACE_USAGE_FORBIDDEN',
  );
});

test('owner can read workspace usage with UTC monthly summary and safe rows', async () => {
  let summaryArgs;
  const service = createUsageService({ repository: repository({
    getUsageSummary: async (args) => { summaryArgs = args; return { credits_used: '3.500000', generation_count: '1' }; },
  }), now: () => new Date('2026-09-07T12:00:00Z') });
  const data = await service.getUsage({ workspaceId: 'w1', userId: 'u1', role: 'owner', scope: 'workspace' });
  assert.equal(summaryArgs.scope, 'workspace');
  assert.equal(summaryArgs.periodStart.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(data.summary.creditsUsed, '3.500000');
  assert.equal(data.items[0].actual_cost, undefined);
  assert.equal(data.items[0].raw_usage, undefined);
});

test('rejects an invalid usage scope and pagination', async () => {
  const service = createUsageService({ repository: repository() });
  await assert.rejects(service.getUsage({ workspaceId: 'w1', userId: 'u1', role: 'owner', scope: 'all' }), (error) => error.status === 400);
  await assert.rejects(service.getUsage({ workspaceId: 'w1', userId: 'u1', role: 'owner', page: '0' }), (error) => error.status === 400);
});
