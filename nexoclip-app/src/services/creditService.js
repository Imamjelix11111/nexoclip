import {
  createCreditAccount,
  findCreditEntryByIdempotencyKey,
  insertCreditEntry,
  lockCreditAccount,
  updateCreditBalance,
} from '../repositories/creditRepository.js';

export async function appendCreditEntry(pool, { workspaceId, amount, reason, idempotencyKey, metadata = {} }) {
  if (!workspaceId || !idempotencyKey || !reason || !Number.isFinite(amount) || amount === 0) {
    throw new Error('Credit entry is invalid');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await createCreditAccount(client, workspaceId);
    const existing = await findCreditEntryByIdempotencyKey(client, workspaceId, idempotencyKey);
    if (existing) {
      await client.query('COMMIT');
      return existing;
    }

    const account = await lockCreditAccount(client, workspaceId);
    const balance = Number(account.balance);
    const nextBalance = balance + amount;
    if (nextBalance < 0) throw new Error('Insufficient credits');

    await updateCreditBalance(client, workspaceId, nextBalance);
    const entry = await insertCreditEntry(client, {
      workspaceId, amount, balanceAfter: nextBalance, reason, idempotencyKey, metadata,
    });
    await client.query('COMMIT');
    return entry;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
