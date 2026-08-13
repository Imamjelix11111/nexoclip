import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionToken,
  hashSessionToken,
  sessionCookieOptions,
} from '../../src/lib/auth/session.js';

test('creates unique 32-byte session tokens', () => {
  const first = createSessionToken();
  const second = createSessionToken();

  assert.equal(typeof first, 'string');
  assert.equal(first.length, 64);
  assert.notEqual(first, second);
});

test('hashes the same token deterministically', () => {
  const token = 'session-token';

  assert.deepEqual(hashSessionToken(token), hashSessionToken(token));
  assert.equal(hashSessionToken(token).length, 32);
});

test('returns secure session cookie options in production', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  assert.deepEqual(sessionCookieOptions(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });

  process.env.NODE_ENV = previous;
});
