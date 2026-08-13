import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '../../../src/lib/auth/session.js';
import { getCurrentSession } from '../../../src/services/authService.js';
import { getUserWorkspaces } from '../../../src/services/workspaceService.js';

export async function GET(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await getCurrentSession(token);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaces = await getUserWorkspaces(session.user_id);
  return NextResponse.json({ workspaces });
}
