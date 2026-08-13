import { getPool } from '../db/pool.js';
import {
  findWorkspaceMembership,
  listUserWorkspaces,
} from '../repositories/workspaceRepository.js';

export async function getUserWorkspaces(userId) {
  if (!userId) throw new Error('userId is required');
  return listUserWorkspaces(getPool(), userId);
}

export async function requireWorkspaceMembership({ userId, workspaceId }) {
  if (!userId || !workspaceId) return null;
  return findWorkspaceMembership(getPool(), workspaceId, userId);
}
