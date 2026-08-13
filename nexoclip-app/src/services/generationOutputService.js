import { getPool } from '../db/pool.js';
import { recordGenerationOutput, recordProviderUsage } from '../repositories/generationOutputRepository.js';

export async function persistGenerationResult(pool, {
  workspaceId, generationId, provider, providerRequestId, estimatedCost = null,
  outputs = [], usage = {},
}) {
  if (!workspaceId || !generationId || !provider || !providerRequestId) {
    throw new TypeError('workspace, generation, provider, and provider request are required');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const savedOutputs = [];
    for (const [outputIndex, output] of outputs.entries()) {
      if (!output?.assetId) throw new TypeError('generation output assetId is required');
      savedOutputs.push(await recordGenerationOutput(client, {
        workspaceId, generationId, providerRequestId, outputIndex, assetId: output.assetId,
      }));
    }
    const savedUsage = await recordProviderUsage(client, {
      workspaceId, generationId, provider, providerRequestId,
      estimatedCost, actualCost: usage.cost ?? null,
      units: usage.units ?? {}, rawUsage: usage.rawUsage ?? {},
    });
    await client.query('COMMIT');
    return { outputs: savedOutputs, usage: savedUsage };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function persistGenerationResultWithDefaultPool(input) {
  return persistGenerationResult(getPool(), input);
}
