import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../../src/lib/auth/session.js';
import { getCurrentSession } from '../../../../src/services/authService.js';

export async function GET(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await getCurrentSession(token);

  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.user_id,
      email: session.email,
      displayName: session.display_name,
    },
    expiresAt: session.expires_at,
  });
}
