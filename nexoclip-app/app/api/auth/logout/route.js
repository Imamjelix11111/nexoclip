import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from '../../../../src/lib/auth/session.js';
import { revokeCurrentSession } from '../../../../src/services/authService.js';

export async function POST(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  await revokeCurrentSession(token);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', {
    ...sessionCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
  return response;
}
