# NexoClip production migration and runtime runbook

This runbook hardens deployment without selecting a queue, object-storage, auth, or payment vendor. The repository remains compatible with the existing MuAPI/BYOK routes.

## Runtime boundary

- **API:** `npm run build && npm start` runs Next.js short requests on port `3000`.
- **Database:** raw PostgreSQL via `DATABASE_URL`; API and worker use `src/db/pool.js`.
- **Migration operator:** run `npm run db:migrate` once per database release, before routing API traffic. Do not run migrations concurrently from every web replica.
- **Worker:** the generation worker implementation is `src/queue/generationWorker.js`; it requires an injected `queue.dequeue` adapter and a provider handler. The provider-neutral image handler is `src/services/saasImageGeneration.js`; it downloads provider outputs into the injected object storage adapter and records tenant-scoped asset metadata. No vendor-specific queue adapter or standalone worker entrypoint is committed yet. Deploy a persistent process that constructs this worker, and fail deployment if the adapter is absent.
- **Queue recovery:** `src/queue/generationQueue.js` claims unpublished queued jobs with `FOR UPDATE SKIP LOCKED`, uses a five-minute claim lease, publishes stable `generation:<id>` idempotency keys, and releases failed claims. `npm run worker:recover` is a fail-closed placeholder until the deployment injects its queue adapter; it must not be treated as a successful recovery command.
- **Provider:** `src/providers/muapi/adapter.js` accepts `MUAPI_API_KEY` only in server/worker code. The image studio uses `/api/generations` only when `nexoclip_workspace_id` is present in session storage; otherwise its existing BYOK path is unchanged. Never pass the key through `NEXT_PUBLIC_*`, browser storage, logs, or error responses.
- **Object storage:** current implementation is local signed storage (`LocalObjectStorage`) for development/prototype use. Set `LOCAL_OBJECT_STORAGE_DIR` and a unique `LOCAL_OBJECT_STORAGE_SECRET`; production binary durability and multi-instance sharing require a separately selected object-storage adapter before beta.

## Environment checklist

1. Copy `.env.example` into a secret manager or local `.env`; never commit `.env`.
2. Set `DATABASE_URL` to the target PostgreSQL database. Verify the migration operator can create tables and indexes.
3. Set `MUAPI_API_KEY` and `MUAPI_BASE_URL` only in API/worker environments. The key is not needed by the browser.
4. Set a random, non-default `LOCAL_OBJECT_STORAGE_SECRET`. Do not reuse the MuAPI key.
5. Run `npm run config:check` with `NODE_ENV=production`. It rejects missing required values, the development storage secret, and `NEXT_PUBLIC_*` secret-shaped names.
6. Keep `NODE_ENV=production`; do not print the environment in diagnostics.

## Empty-database migration smoke test

Use an isolated disposable PostgreSQL database, never a production database:

```sh
# Start local PostgreSQL only (port 5434 in docker-compose.yml)
docker compose up -d nexoclip-postgres

# Use an isolated database/schema supplied by the operator
DATABASE_URL='postgres://nexoclip:nexoclip_dev@localhost:5434/nexoclip' npm run db:migrate
DATABASE_URL='postgres://nexoclip:nexoclip_dev@localhost:5434/nexoclip' npm run db:migrate
```

The first command must apply each ordered file in `src/db/migrations/`; the second must be a no-op and exit zero. Inspect `schema_migrations` and confirm all migration filenames are present. Destroy the disposable volume after the smoke test when it is no longer needed (`docker compose down -v`).

## Release order and rollback

1. Build the exact application artifact: `npm run build`.
2. Run `npm run config:check` in the API and worker environments.
3. Snapshot/backup PostgreSQL according to the selected hosting provider.
4. Apply migrations once with `npm run db:migrate`; stop on the first failed migration.
5. Start the persistent worker with the configured queue and MuAPI adapter; verify it can dequeue and claim a test job without exposing secrets.
6. Start the API with `npm start`; verify auth, workspace authorization, asset signed URL, and generation status endpoints using non-production fixtures.
7. Monitor failed jobs, stale queue claims, provider errors, and credit settlement before enabling traffic.

Migrations are forward-only. Do not manually delete rows from `schema_migrations` or edit an applied migration. If a migration fails, preserve the error, restore the database backup only under the release rollback procedure, and ship a new corrective migration. Compatibility routes remain available and are not part of this migration.

## Secret and incident handling

- Rotate `MUAPI_API_KEY` and `LOCAL_OBJECT_STORAGE_SECRET` through the secret manager, then restart API and worker processes.
- Redact authorization headers, provider request headers, database URLs, signed URLs, prompts, output URLs, and raw provider usage from logs.
- Never paste credentials into Notion, git, issue trackers, test fixtures, or chat.
- If a secret appears in a log or diff: revoke it, remove it from the source, inspect history/log retention, and record the incident without copying the value.

## Current blockers / explicit non-decisions

- No queue vendor or adapter has been selected; a production worker cannot be started from this repository alone.
- No durable production object-storage adapter has been selected; local storage is not a multi-instance production solution.
- Auth provider, payment provider, RLS, admin UI, and billing integration remain intentionally out of scope.
