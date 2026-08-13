import { getPool } from '../db/pool.js';
import {
  createProject,
  deleteProject,
  findProject,
  listProjects,
  updateProject,
} from '../repositories/projectRepository.js';

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function validateProjectInput(input) {
  const name = String(input?.name || '').trim();
  const slug = slugify(input?.slug || name);
  if (!name || name.length > 120) throw new Error('Project name is required');
  if (!slug || slug.length < 2) throw new Error('Project slug is invalid');
  return { name, slug, description: String(input?.description || '').trim() || null };
}

export async function getProjects(workspaceId) {
  return listProjects(getPool(), workspaceId);
}

export async function getProject(workspaceId, projectId) {
  return findProject(getPool(), workspaceId, projectId);
}

export async function createWorkspaceProject(workspaceId, input) {
  return createProject(getPool(), { workspaceId, ...validateProjectInput(input) });
}

export async function updateWorkspaceProject(workspaceId, projectId, input) {
  return updateProject(getPool(), {
    workspaceId,
    projectId,
    ...validateProjectInput(input),
  });
}

export async function removeWorkspaceProject(workspaceId, projectId) {
  return deleteProject(getPool(), workspaceId, projectId);
}
