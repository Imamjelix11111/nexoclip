import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'nexoclip_session';

export function createSessionToken() {
  return randomBytes(32).toString('hex');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest();
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}
