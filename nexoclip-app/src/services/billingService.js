import { createOrGetWebhookEvent, markWebhookFailed, markWebhookProcessed } from '../repositories/billingRepository.js';

export function createBillingWebhookService({ pool, verifier, handler }) {
  return {
    async receive({ providerKey, eventId, eventType = 'unknown', rawBody, signature }) {
      if (!providerKey || !eventId || typeof rawBody !== 'string') throw new Error('Webhook envelope is invalid');
      if (!(await verifier({ providerKey, rawBody, signature }))) throw new Error('Invalid webhook signature');
      let payload;
      try { payload = JSON.parse(rawBody); } catch { throw new Error('Webhook payload is invalid'); }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { event, inserted } = await createOrGetWebhookEvent(client, { providerKey, eventId, eventType, payload });
        if (!inserted && event.status === 'processed') {
          await client.query('COMMIT');
          return event;
        }
        await client.query('COMMIT');
        try {
          await handler({ providerKey, eventId, eventType, payload });
        } catch (error) {
          await client.query('BEGIN');
          const failed = await markWebhookFailed(client, providerKey, eventId, error.message);
          await client.query('COMMIT');
          throw error;
        }
        await client.query('BEGIN');
        const processed = await markWebhookProcessed(client, providerKey, eventId);
        await client.query('COMMIT');
        return processed;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      } finally { client.release(); }
    },
  };
}
