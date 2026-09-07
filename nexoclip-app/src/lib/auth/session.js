import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'nexoclip_session';

export function createSessionToken() {
  return randomBytes(32).toString('hex');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest();
}

export function sessionCookieOptions(request) {
  const forwardedProto = request?.headers?.get?.('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = request?.url ? new URL(request.url).protocol : null;
  return {
    httpOnly: true,
    secure: forwardedProto ? forwardedProto === 'https' : protocol ? protocol === 'https:' : process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}
