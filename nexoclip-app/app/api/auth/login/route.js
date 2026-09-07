import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from '../../../../src/lib/auth/session.js';
import { loginUser } from '../../../../src/services/authService.js';

export async function POST(request) {
  try {
    const result = await loginUser(await request.json());
    const response = NextResponse.json({ user: result.user });
    response.cookies.set(SESSION_COOKIE, result.token, {
      ...sessionCookieOptions(request),
      maxAge: Math.floor((result.expiresAt.getTime() - Date.now()) / 1000),
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }
}
