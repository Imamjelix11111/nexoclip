import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from '../../../../src/lib/auth/session.js';
import { registerUser } from '../../../../src/services/authService.js';

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await registerUser(body);
    const response = NextResponse.json({
      user: result.user,
      workspace: result.workspace,
    }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, result.token, {
      ...sessionCookieOptions(),
      maxAge: Math.floor((result.expiresAt.getTime() - Date.now()) / 1000),
    });
    return response;
  } catch (error) {
    const status = error.message === 'Email already registered' ? 409 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
}
