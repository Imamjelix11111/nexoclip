import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const setupSqlPath = join(here, '..', '..', 'database-setup.sql')
const setupSql = readFileSync(setupSqlPath, 'utf8')
const normalizedSql = setupSql.replace(/\s+/g, ' ').toLowerCase()

function expectContains(fragment: string): void {
  assert.ok(
    normalizedSql.includes(fragment.toLowerCase()),
    `Expected database-setup.sql to contain: ${fragment}`,
  )
}

test('database-setup defines durable canvas_yjs_documents table with sequence constraints', () => {
  expectContains('create table if not exists canvas_yjs_documents')
  expectContains('project_id uuid primary key references projects(id) on delete cascade')
  expectContains('snapshot bytea')
  expectContains('snapshot_seq bigint not null default 0')
  expectContains('durable_seq bigint not null default 0')
  expectContains('projected_seq bigint not null default 0')
  expectContains('schema_version integer not null default 1')
  expectContains('updated_at timestamptz not null default now()')
  expectContains('check (snapshot_seq <= durable_seq)')
  expectContains('check (projected_seq <= durable_seq)')
})

test('database-setup defines append-only canvas_yjs_updates ordering per project', () => {
  expectContains('create table if not exists canvas_yjs_updates')
  expectContains('project_id uuid not null references projects(id) on delete cascade')
  expectContains('seq bigint not null')
  expectContains('check (seq > 0)')
  expectContains('update_data bytea not null')
  expectContains('created_at timestamptz not null default now()')
  expectContains('primary key (project_id, seq)')
})

test('database-setup defines replay-protected auth nonce table with expiry index', () => {
  expectContains('create table if not exists canvas_auth_nonces')
  expectContains('nonce text primary key')
  expectContains('created_at timestamptz not null default now()')
  expectContains('expires_at timestamptz not null')
  expectContains('create index if not exists idx_canvas_auth_nonces_expires_at on canvas_auth_nonces (expires_at)')
})

test('realtime schema never introduces cross-database user foreign keys', () => {
  const realtimeBlocks = normalizedSql
    .split('create table if not exists')
    .filter((block) =>
      ['canvas_yjs_documents', 'canvas_yjs_updates', 'canvas_auth_nonces'].some((name) =>
        block.includes(name),
      ),
    )
    .join(' ')

  assert.equal(realtimeBlocks.includes('references users'), false)
  assert.equal(realtimeBlocks.includes('references auth.users'), false)
})
