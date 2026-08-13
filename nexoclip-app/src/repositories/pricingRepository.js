const versionColumns = 'id, version, status, effective_at, created_at';
const ruleColumns = 'id, pricing_version_id, operation, unit, unit_price, metadata';

export async function findPricingRule(pool, { operation, pricingVersion = null }) {
  const values = [operation];
  let versionClause = "pv.status = 'active' AND pv.effective_at <= now()";
  if (pricingVersion) {
    values.push(pricingVersion);
    versionClause = 'pv.id = $2';
  }
  const result = await pool.query(
    `SELECT pr.${ruleColumns.replaceAll(', ', ', pr.')},
            pv.id AS pricing_version_id, pv.version AS pricing_version,
            pv.status AS pricing_version_status, pv.effective_at
       FROM pricing_rules pr
       JOIN pricing_versions pv ON pv.id = pr.pricing_version_id
      WHERE pr.operation = $1 AND ${versionClause}
      ORDER BY pv.effective_at DESC, pv.version DESC
      LIMIT 1`,
    values,
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    pricingVersion: { id: row.pricing_version_id, version: row.pricing_version },
    rule: { operation: row.operation, unit: row.unit, unitPrice: row.unit_price },
  };
}

export async function createPricingVersion(client, { version, status = 'draft', effectiveAt = null }) {
  const result = await client.query(
    `INSERT INTO pricing_versions (version, status, effective_at)
     VALUES ($1, $2, COALESCE($3::timestamptz, now())) RETURNING ${versionColumns}`,
    [version, status, effectiveAt],
  );
  return result.rows[0];
}

export async function createPricingRule(client, { pricingVersionId, operation, unit, unitPrice, metadata = {} }) {
  const result = await client.query(
    `INSERT INTO pricing_rules (pricing_version_id, operation, unit, unit_price, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING ${ruleColumns}`,
    [pricingVersionId, operation, unit, unitPrice, JSON.stringify(metadata)],
  );
  return result.rows[0];
}
