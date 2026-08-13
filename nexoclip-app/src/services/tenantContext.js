import { getCurrentSession } from './authService.js';
import { requireWorkspaceMembership } from './workspaceService.js';

export async function resolveTenantContext({
  token,
  workspaceId,
  sessionLookup = getCurrentSession,
  membershipLookup = async (userId, id) => requireWorkspaceMembership({
    userId,
    workspaceId: id,
  }),
}) {
  const session = await sessionLookup(token);
  if (!session) throw new Error('Authentication required');

  const membership = await membershipLookup(session.user_id, workspaceId);
  if (!membership) throw new Error('Workspace access denied');

  return {
    user: { id: session.user_id, email: session.email },
    workspace: {
      id: membership.id,
      user_id: membership.user_id,
      role: membership.role,
    },
  };
}
