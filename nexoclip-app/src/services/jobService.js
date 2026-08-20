import * as jobRepository from '../repositories/jobRepository.js';

function toJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    params: row.parameters ?? {},
    result: row.result ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createJob({ pool, workspaceId, kind, params }) {
  return toJob(await jobRepository.insertJob(pool, { workspaceId, kind, params }));
}

export async function getJob({ pool, workspaceId, id }) {
  return toJob(await jobRepository.findJob(pool, workspaceId, id));
}

export async function listJobs({ pool, workspaceId, statuses = null, kind = null, limit = 50 }) {
  const rows = await jobRepository.listJobs(pool, { workspaceId, statuses, kind, limit });
  return { jobs: rows.map(toJob) };
}

export async function updateJobStatus({ pool, workspaceId, id, status, result = null, error = null }) {
  return toJob(await jobRepository.updateJob(pool, { workspaceId, id, status, result, error }));
}
