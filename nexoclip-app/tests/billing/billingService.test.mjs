import test from 'node:test';
import assert from 'node:assert/strict';
import { createBillingWebhookService } from '../../src/services/billingService.js';

function fakePool() {
  const calls = [];
  return { calls, async connect() {
    return {
      async query(text, values) {
        calls.push({ text, values });
        if (text.includes('INSERT INTO billing_webhook_events')) return { rows: [{ id: 'event-1', status: 'pending' }] };
        if (text.includes('UPDATE billing_webhook_events')) return { rows: [{ id: 'event-1', status: 'processed' }] };
        return { rows: [] };
      }, release() {},
    };
  } };
}

test('verifies and processes a webhook once, then records it processed', async () => {
  const pool = fakePool();
  let handled = 0;
  const service = createBillingWebhookService({
    pool,
    verifier: async ({ rawBody, signature }) => rawBody === '{"ok":true}' && signature === 'sig',
    handler: async (event) => { handled += 1; assert.equal(event.eventId, 'evt-1'); },
  });
  const result = await service.receive({ providerKey: 'development', eventId: 'evt-1', rawBody: '{"ok":true}', signature: 'sig' });
  assert.equal(result.status, 'processed');
  assert.equal(handled, 1);
  assert.equal(pool.calls.filter(({ text }) => text.includes('UPDATE billing_webhook_events')).length, 1);
});

test('rejects an invalid webhook signature before persistence', async () => {
  const pool = fakePool();
  const service = createBillingWebhookService({ pool, verifier: async () => false, handler: async () => {} });
  await assert.rejects(() => service.receive({ providerKey: 'development', eventId: 'evt-2', rawBody: '{}', signature: 'bad' }), /Invalid webhook signature/);
  assert.equal(pool.calls.length, 0);
});
