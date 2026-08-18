import {
  createCreditAccount,
  findCreditEntryByIdempotencyKey,
  insertCreditEntry,
  lockCreditAccount,
  updateCreditBalance,
} from '../repositories/creditRepository.js';
import { findPendingTerminalGenerations, lockGenerationForSettlement, settleUnreservedGeneration as transitionUnreservedGeneration, updateGenerationSettlement } from '../repositories/generationSettlementRepository.js';

function validateAmount(amount) {
  if (!Number.isFinite(Number(amount)) || Number(amount) < 0) throw new TypeError('Settlement amount is invalid');
  return Number(amount);
}

async function settle(pool, { workspaceId, generationId, action, amount }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const generation = await lockGenerationForSettlement(client, workspaceId, generationId);
    if (!generation) throw new Error('Generation not found');
    if (generation.settlement_status !== 'pending') {
      await client.query('COMMIT');
      return generation;
    }

    const settlementAmount = amount === undefined ? validateAmount(generation.estimated_cost) : validateAmount(amount);
    const idempotencyKey = `generation:settlement:${action}:${generationId}`;
    const existing = await findCreditEntryByIdempotencyKey(client, workspaceId, idempotencyKey);
    if (!existing) {
      await createCreditAccount(client, workspaceId);
      const account = await lockCreditAccount(client, workspaceId);
      const balance = Number(account.balance);
      const nextBalance = balance + settlementAmount;
      await updateCreditBalance(client, workspaceId, nextBalance);
      await insertCreditEntry(client, {
        workspaceId, amount: settlementAmount, balanceAfter: nextBalance,
        reason: `generation_${action}`, idempotencyKey,
        metadata: { generationId, reservationLedgerId: generation.reservation_ledger_id },
      });
    }
    const updated = await updateGenerationSettlement(client, workspaceId, generationId, 'pending', action === 'capture' ? 'captured' : action === 'release' ? 'released' : 'refunded');
    await client.query('COMMIT');
    return updated || generation;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function captureGenerationCredits(pool, { workspaceId, generationId, actualCost }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const generation = await lockGenerationForSettlement(client, workspaceId, generationId);
    if (!generation) throw new Error('Generation not found');
    if (generation.settlement_status !== 'pending') { await client.query('COMMIT'); return generation; }
    const estimated = validateAmount(generation.estimated_cost);
    const cost = actualCost === undefined ? estimated : validateAmount(actualCost);
    const refund = estimated - cost;
    if (refund < 0) throw new Error('Actual cost exceeds reservation');
    const idempotencyKey = `generation:settlement:capture:${generationId}`;
    if (refund > 0 && !await findCreditEntryByIdempotencyKey(client, workspaceId, idempotencyKey)) {
      await createCreditAccount(client, workspaceId);
      const account = await lockCreditAccount(client, workspaceId);
      const nextBalance = Number(account.balance) + refund;
      await updateCreditBalance(client, workspaceId, nextBalance);
      await insertCreditEntry(client, { workspaceId, amount: refund, balanceAfter: nextBalance, reason: 'generation_capture', idempotencyKey, metadata: { generationId, actualCost: cost, reservedCost: estimated } });
    }
    const updated = await updateGenerationSettlement(client, workspaceId, generationId, 'pending', 'captured');
    await client.query('COMMIT');
    return updated || generation;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function settleUnreservedGeneration(pool, { workspaceId, generationId, status }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const generation = await lockGenerationForSettlement(client, workspaceId, generationId);
    if (!generation) throw new Error('Generation not found');
    if (generation.reservation_ledger_id !== null) throw new Error('Generation has a reservation ledger');
    if (generation.settlement_status !== 'pending') {
      await client.query('COMMIT');
      return generation;
    }
    const updated = await transitionUnreservedGeneration(client, workspaceId, generationId, status);
    await client.query('COMMIT');
    return updated || generation;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function recoverUnreservedGenerations(pool) {
  const generations = await findPendingTerminalGenerations(pool);
  return Promise.all(generations.map(async ({ workspace_id: workspaceId, id: generationId, status, reservation_ledger_id: reservationLedgerId }) => {
    if (reservationLedgerId === null) return settleUnreservedGeneration(pool, { workspaceId, generationId, status });
    return status === 'succeeded'
      ? captureGenerationCredits(pool, { workspaceId, generationId, actualCost: undefined })
      : releaseGenerationReservation(pool, { workspaceId, generationId });
  }));
}

export function releaseGenerationReservation(pool, args) {
  return settle(pool, { ...args, action: 'release', amount: undefined });
}

export async function refundGenerationReservation(pool, { workspaceId, generationId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const generation = await lockGenerationForSettlement(client, workspaceId, generationId);
    if (!generation) throw new Error('Generation not found');
    if (generation.settlement_status !== 'pending') { await client.query('COMMIT'); return generation; }
    const amount = validateAmount(generation.estimated_cost);
    const idempotencyKey = `generation:settlement:refund:${generationId}`;
    if (!await findCreditEntryByIdempotencyKey(client, workspaceId, idempotencyKey)) {
      await createCreditAccount(client, workspaceId);
      const account = await lockCreditAccount(client, workspaceId);
      const nextBalance = Number(account.balance) + amount;
      await updateCreditBalance(client, workspaceId, nextBalance);
      await insertCreditEntry(client, { workspaceId, amount, balanceAfter: nextBalance, reason: 'generation_refund', idempotencyKey, metadata: { generationId, reservationLedgerId: generation.reservation_ledger_id } });
    }
    const updated = await updateGenerationSettlement(client, workspaceId, generationId, 'pending', 'refunded');
    await client.query('COMMIT');
    return updated || generation;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
