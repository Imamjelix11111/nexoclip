import { promisify } from 'node:util';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Password must be at least 12 characters');
  }

  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  });

  return `scrypt$${COST}$${salt.toString('hex')}$${Buffer.from(derivedKey).toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, cost, saltHex, keyHex] = String(storedHash).split('$');
  if (algorithm !== 'scrypt' || !cost || !saltHex || !keyHex) return false;

  try {
    const expected = Buffer.from(keyHex, 'hex');
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(cost),
      r: BLOCK_SIZE,
      p: PARALLELIZATION,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
