const SCALE = 6n;
const SCALE_FACTOR = 10n ** SCALE;

function parsePrice(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error('Unit price must be a non-negative decimal with up to 6 places');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE_FACTOR + BigInt(fraction.padEnd(Number(SCALE), '0'));
}

function formatAmount(value) {
  const whole = value / SCALE_FACTOR;
  const fraction = String(value % SCALE_FACTOR).padStart(Number(SCALE), '0');
  return `${whole}.${fraction}`;
}

export function estimateCost({ pricingVersion, rule, quantity }) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive integer');
  }
  if (!pricingVersion?.id || !Number.isSafeInteger(pricingVersion.version) || pricingVersion.version <= 0) {
    throw new Error('Pricing version is invalid');
  }
  if (!rule?.operation || !rule?.unit) throw new Error('Pricing rule is invalid');

  const amount = parsePrice(rule.unitPrice) * BigInt(quantity);
  return {
    pricingVersionId: pricingVersion.id,
    pricingVersion: pricingVersion.version,
    operation: rule.operation,
    unit: rule.unit,
    quantity,
    amount: formatAmount(amount),
  };
}

export async function estimateCostForOperation(pool, { operation, quantity, pricingVersion = null }) {
  const { findPricingRule } = await import('../repositories/pricingRepository.js');
  const selected = await findPricingRule(pool, { operation, pricingVersion });
  if (!selected) throw new Error('Pricing rule not found');
  return estimateCost({ ...selected, quantity });
}
