import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../../src/lib/auth/password.js';

test('hashes and verifies a password without storing the plaintext', async () => {
  const password = 'correct horse battery staple';
  const hash = await hashPassword(password);

  assert.notEqual(hash, password);
  assert.match(hash, /^scrypt\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});
