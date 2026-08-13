const eventColumns = 'id, provider_key, event_id, event_type, payload, status, processing_error, received_at, processed_at';
const planColumns = 'id, code, name, description, monthly_credits, metadata, active, created_at, updated_at';
const subscriptionColumns = 'id, workspace_id, billing_plan_id, status, provider_key, provider_subscription_id, current_period_start, current_period_end, cancel_at_period_end, metadata, created_at, updated_at';

export async function findBillingPlan(pool, code) {
  const result = await pool.query(`SELECT ${planColumns} FROM billing_plans WHERE code = $1 AND active = true`, [code]);
  return result.rows[0] || null;
}

export async function findWorkspaceSubscription(pool, workspaceId) {
  const result = await pool.query(`SELECT ${subscriptionColumns} FROM workspace_subscriptions WHERE workspace_id = $1`, [workspaceId]);
  return result.rows[0] || null;
}

export async function upsertWorkspaceSubscription(client, { workspaceId, billingPlanId, status = 'active', providerKey = null, providerSubscriptionId = null, currentPeriodStart = null, currentPeriodEnd = null, cancelAtPeriodEnd = false, metadata = {} }) {
  const result = await client.query(
    `INSERT INTO workspace_subscriptions
       (workspace_id, billing_plan_id, status, provider_key, provider_subscription_id, current_period_start, current_period_end, cancel_at_period_end, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (workspace_id) DO UPDATE SET billing_plan_id = EXCLUDED.billing_plan_id, status = EXCLUDED.status,
       provider_key = EXCLUDED.provider_key, provider_subscription_id = EXCLUDED.provider_subscription_id,
       current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end, metadata = EXCLUDED.metadata, updated_at = now()
     RETURNING ${subscriptionColumns}`,
    [workspaceId, billingPlanId, status, providerKey, providerSubscriptionId, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, JSON.stringify(metadata)],
  );
  return result.rows[0];
}

export async function createOrGetWebhookEvent(client, { providerKey, eventId, eventType, payload }) {
  const result = await client.query(
    `INSERT INTO billing_webhook_events (provider_key, event_id, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (provider_key, event_id) DO NOTHING
     RETURNING ${eventColumns}`,
    [providerKey, eventId, eventType, JSON.stringify(payload)],
  );
  if (result.rows[0]) return { event: result.rows[0], inserted: true };
  const existing = await client.query(
    `SELECT ${eventColumns} FROM billing_webhook_events WHERE provider_key = $1 AND event_id = $2 FOR UPDATE`,
    [providerKey, eventId],
  );
  return { event: existing.rows[0], inserted: false };
}

export async function markWebhookProcessed(client, providerKey, eventId) {
  const result = await client.query(
    `UPDATE billing_webhook_events SET status = 'processed', processed_at = now(), processing_error = NULL
     WHERE provider_key = $1 AND event_id = $2 RETURNING ${eventColumns}`,
    [providerKey, eventId],
  );
  return result.rows[0] || null;
}

export async function markWebhookFailed(client, providerKey, eventId, error) {
  const result = await client.query(
    `UPDATE billing_webhook_events SET status = 'failed', processing_error = $3
     WHERE provider_key = $1 AND event_id = $2 RETURNING ${eventColumns}`,
    [providerKey, eventId, String(error).slice(0, 500)],
  );
  return result.rows[0] || null;
}
