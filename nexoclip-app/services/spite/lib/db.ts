import { neon } from '@neondatabase/serverless'

type DatabaseEnvironment = Partial<Pick<NodeJS.ProcessEnv, 'DATABASE_URL' | 'DATABASE_URL_SPITE'>>

export function resolveSpiteDatabaseUrl(env: DatabaseEnvironment = process.env): string {
  const databaseUrl = env.DATABASE_URL_SPITE || env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL_SPITE or DATABASE_URL environment variable is not set')
  }
  return databaseUrl
}

// Spite is isolated on Neon. DATABASE_URL remains a backwards-compatible
// fallback for local/legacy environments that do not expose the dedicated URL.
export function getDb() {
  return neon(resolveSpiteDatabaseUrl())
}

// Shape of the sql tagged-template returned by `neon()`. Exported for
// helper modules that take a sql instance as a parameter (e.g. the
// ensureSchema helpers in lib/sessions.ts, fal-voices.ts).
export type Sql = ReturnType<typeof getDb>

// Namespace for the per-project canvas-write advisory lock (the int4 spells
// "SPIT"). EVERY code path that bulk-rewrites a project's canvas_nodes/edges
// — the autosave AND the snapshot restore — must take
// pg_advisory_xact_lock(CANVAS_SAVE_LOCK_NS, hashtext(projectId)) as the first
// statement of its write transaction. They share this key so they serialize
// against each other instead of deadlocking on the same rows. Combined with a
// second int key, it can't collide with the spend gate's single-bigint lock.
export const CANVAS_SAVE_LOCK_NS = 0x53504954
