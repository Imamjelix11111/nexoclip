function json(value) {
  return JSON.stringify(value ?? {});
}

export async function recordGenerationOutput(client, {
  workspaceId, generationId, providerRequestId, outputIndex, assetId,
}) {
  const result = await client.query(
    `INSERT INTO generation_outputs
       (workspace_id, generation_job_id, provider_request_id, output_index, asset_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, generation_job_id, provider_request_id, output_index)
     DO UPDATE SET asset_id = EXCLUDED.asset_id
     RETURNING id, workspace_id, generation_job_id, provider_request_id, output_index, asset_id, created_at`,
    [workspaceId, generationId, providerRequestId, outputIndex, assetId],
  );
  return result.rows[0];
}

export async function recordProviderUsage(client, {
  workspaceId, generationId, provider, providerRequestId,
  estimatedCost = null, actualCost = null, units = {}, rawUsage = {},
}) {
  const result = await client.query(
    `INSERT INTO provider_usage
       (workspace_id, generation_job_id, provider, provider_request_id,
        estimated_cost, actual_cost, units, raw_usage)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
     ON CONFLICT (workspace_id, generation_job_id, provider_request_id)
     DO UPDATE SET estimated_cost = EXCLUDED.estimated_cost,
                   actual_cost = EXCLUDED.actual_cost,
                   units = EXCLUDED.units,
                   raw_usage = EXCLUDED.raw_usage,
                   updated_at = now()
     RETURNING id, workspace_id, generation_job_id, provider, provider_request_id,
               estimated_cost, actual_cost, units, raw_usage, created_at, updated_at`,
    [workspaceId, generationId, provider, providerRequestId, estimatedCost, actualCost, json(units), json(rawUsage)],
  );
  return result.rows[0];
}
