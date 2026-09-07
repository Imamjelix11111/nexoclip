# AMD64 VPS Docker Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a reproducible Docker Compose deployment for the complete NexoClip stack on one Ubuntu x86_64 VPS, with path-based HTTP routing and managed Neon/R2 dependencies.

**Architecture:** One production Compose project builds separate AMD64 images for the three Next.js applications, AI Clip, ViMax, and the NexoClip worker. Caddy is the only public container; Redis and runtime services remain private. NexoClip, SPITE, and Scheduler use separate Neon databases, while application secrets are loaded only from a host-side `.env.production` file.

**Tech Stack:** Docker Engine, Docker Compose v2, Caddy 2, Node.js 20, Next.js 15/16, Python 3.13, uv, FastAPI/Uvicorn, Redis 7, Neon PostgreSQL, Prisma 7, Cloudflare R2.

## Global Constraints

- Target Ubuntu Server 24.04 LTS on x86_64/AMD64 only.
- Every Compose service must declare `platform: linux/amd64`; ARM64 support is out of scope.
- Only Caddy publishes host ports; Redis, ViMax, worker callbacks, and application ports remain private.
- Public routes are `/`, `/spite/*`, `/scheduler/*`, and `/ai-clip-api/*`.
- Keep PostgreSQL on three separate Neon databases: `nexoclip_app`, `neondb`, and `scheduler`.
- Keep generated media in Cloudflare R2 and temporary/runtime data in named Docker volumes.
- Never copy `.env`, `.env.production`, credentials, or local generated state into an image or Git.
- Preserve unrelated working-tree changes in `src/providers/providerRegistry.js`, provider tests, `.superpowers/brainstorm/`, and the Seedream plan.
- Prefer existing package managers and dependencies; add no deployment framework beyond Docker Compose and Caddy.

---

## File Structure

### Create

- `.dockerignore` — excludes secrets, caches, generated data, and nested service build artifacts from the root build context.
- `.env.production.example` — complete placeholder-only Compose/runtime configuration contract.
- `docker-compose.prod.yml` — service graph, AMD64 constraints, health checks, volumes, migrations, and environment wiring.
- `Caddyfile` — path routing and prefix stripping for AI Clip.
- `services/spite/Dockerfile` — SPITE multi-stage standalone image.
- `services/spite/lib/base-path.ts` — browser-safe prefix helper for raw fetch URLs.
- `services/free-ai-social-media-scheduler/Dockerfile` — Scheduler multi-stage standalone image.
- `services/free-ai-social-media-scheduler/src/lib/base-path.js` — browser-safe prefix helper.
- `services/free-ai-social-media-scheduler/prisma/migrations/0001_init/migration.sql` — reproducible initial Scheduler schema.
- `services/ai-clip/Dockerfile` — CPU-only AI Clip image with FFmpeg/local requirements.
- `services/ai-clip/.dockerignore` — excludes local Python/output state and secrets.
- `scripts/deploy.sh` — guarded build, migration, startup, and status workflow.
- `tests/deployment/dockerDeployment.test.mjs` — static deployment contract tests.
- `services/spite/lib/base-path.test.ts` — SPITE path helper unit tests.
- `services/free-ai-social-media-scheduler/src/lib/base-path.test.mjs` — Scheduler path helper unit tests.
- `docs/deployment/ubuntu-amd64.md` — VPS provisioning, secret setup, deploy, verification, update, and rollback runbook.

### Modify

- `Dockerfile` — add standalone output and separate NexoClip web/worker/migration runtime targets.
- `next.config.mjs` — enable NexoClip standalone output.
- `services/spite/next.config.mjs` — enable standalone output and build-time `/spite` base path.
- SPITE client files that call root-relative `/api/*` URLs — wrap raw request URLs with `withBasePath()`.
- `services/free-ai-social-media-scheduler/next.config.mjs` — enable standalone output and `/scheduler` base path.
- Scheduler client/auth files that use root-relative URLs — wrap requests/callbacks with `withBasePath()` or configure NextAuth base URL correctly.
- `services/vimax/Dockerfile` — pin runtime behavior, add non-root execution and health check prerequisites without changing its API.
- `.gitignore` — ignore `.env.production` while retaining `.env.production.example`.
- `package.json` — add deployment contract test command only if needed by existing test conventions.

---

### Task 1: Lock the Deployment Contract with Static Tests

**Files:**
- Create: `tests/deployment/dockerDeployment.test.mjs`
- Modify: none

**Interfaces:**
- Consumes: design requirements in `docs/superpowers/specs/2026-09-07-amd64-vps-docker-deployment-design.md`.
- Produces: a Node test that validates required Compose services, AMD64 declarations, public port isolation, secret-file exclusion, Caddy routes, and Dockerfile presence.

- [ ] **Step 1: Write the failing deployment contract test**

Use Node's built-in `node:test`, `assert/strict`, and `fs` modules. Parse `docker-compose.prod.yml` as text rather than adding a YAML dependency. Assert that it contains service blocks for `caddy`, `nexoclip`, `spite`, `scheduler`, `ai-clip`, `vimax`, `storyboard-worker`, `redis`, `nexoclip-migrate`, and `scheduler-migrate`; that every service block declares `platform: linux/amd64`; that only Caddy has a `ports:` block; and that required files exist. Also assert `.dockerignore` excludes `.env*` with an allow-rule for example files.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const serviceBlock = (compose, name, nextName) => {
  const start = compose.indexOf(`  ${name}:\n`);
  const end = nextName ? compose.indexOf(`  ${nextName}:\n`, start + 1) : compose.indexOf('\nvolumes:', start + 1);
  assert.notEqual(start, -1, `missing service ${name}`);
  return compose.slice(start, end === -1 ? undefined : end);
};

test('production compose is AMD64 and exposes only Caddy', () => {
  const compose = read('docker-compose.prod.yml');
  const names = ['caddy', 'redis', 'nexoclip-migrate', 'scheduler-migrate', 'vimax', 'ai-clip', 'nexoclip', 'spite', 'scheduler', 'storyboard-worker'];
  names.forEach((name, index) => {
    const block = serviceBlock(compose, name, names[index + 1]);
    assert.match(block, /platform: linux\/amd64/);
    if (name === 'caddy') assert.match(block, /ports:/);
    else assert.doesNotMatch(block, /\n\s+ports:/);
  });
});

test('deployment files and routes exist', () => {
  for (const path of ['Caddyfile', '.dockerignore', '.env.production.example', 'services/spite/Dockerfile', 'services/free-ai-social-media-scheduler/Dockerfile', 'services/ai-clip/Dockerfile']) {
    assert.equal(existsSync(path), true, `missing ${path}`);
  }
  const caddy = read('Caddyfile');
  assert.match(caddy, /handle_path \/ai-clip-api\/\*/);
  assert.match(caddy, /handle \/spite\*/);
  assert.match(caddy, /handle \/scheduler\*/);
});

test('Docker context excludes secrets', () => {
  const ignore = read('.dockerignore');
  assert.match(ignore, /^\.env\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
  assert.match(ignore, /^!\.env\.production\.example$/m);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `rtk node --test tests/deployment/dockerDeployment.test.mjs`

Expected: FAIL because the production Compose, Caddy, and service Dockerfiles do not exist.

- [ ] **Step 3: Commit the failing contract**

```bash
rtk git add tests/deployment/dockerDeployment.test.mjs
rtk git commit -m "test(deploy): define Docker stack contract"
```

---

### Task 2: Make SPITE Safe Under `/spite`

**Files:**
- Create: `services/spite/lib/base-path.ts`
- Create: `services/spite/lib/base-path.test.ts`
- Modify: `services/spite/next.config.mjs`
- Modify: `services/spite/middleware.ts`
- Modify: SPITE client files returned by `rg "fetch\('/api|fetch\(\"/api|useSWR.*'/api|href=\"/|router\.push\('/" services/spite/app services/spite/components`

**Interfaces:**
- Consumes: build variable `NEXT_PUBLIC_BASE_PATH`, fixed to `/spite` in Compose.
- Produces: `withBasePath(path: string): string`, returning a prefixed internal URL while leaving absolute external URLs unchanged.

- [ ] **Step 1: Write failing path-helper tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { withBasePath } from './base-path'

test('prefixes root-relative application URLs', () => {
  assert.equal(withBasePath('/api/projects', '/spite'), '/spite/api/projects')
  assert.equal(withBasePath('/', '/spite'), '/spite')
})

test('does not duplicate the prefix or alter external URLs', () => {
  assert.equal(withBasePath('/spite/api/projects', '/spite'), '/spite/api/projects')
  assert.equal(withBasePath('https://example.com/a', '/spite'), 'https://example.com/a')
})
```

Export the helper with an optional second argument solely to make the behavior testable without mutating process state:

```ts
export function withBasePath(path: string, basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''): string
```

- [ ] **Step 2: Run the helper test and verify RED**

Run from `services/spite`: `rtk npx tsx --test lib/base-path.test.ts`

Expected: FAIL because `lib/base-path.ts` does not exist.

- [ ] **Step 3: Implement the minimal helper**

Rules:

```ts
export function withBasePath(path: string, basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '') {
  const base = basePath.replace(/\/$/, '')
  if (!base || !path.startsWith('/') || path === base || path.startsWith(`${base}/`)) return path
  return path === '/' ? base : `${base}${path}`
}
```

- [ ] **Step 4: Enable standalone/basePath configuration**

In `services/spite/next.config.mjs`, normalize `NEXT_PUBLIC_BASE_PATH` and add:

```js
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '')

const nextConfig = {
  output: 'standalone',
  basePath,
  // retain all existing typescript, images, env, and headers settings
}
```

Do not hard-code `/spite` so local root development continues to work when the variable is unset.

- [ ] **Step 5: Convert raw SPITE browser URLs**

Import `withBasePath` only in client modules containing raw root-relative API requests or imperative router redirects. Replace examples as follows:

```ts
fetch('/api/projects')
// becomes
fetch(withBasePath('/api/projects'))

useSWR<Project[]>('/api/projects', fetcher)
// becomes
useSWR<Project[]>(withBasePath('/api/projects'), fetcher)

router.push('/login')
// becomes
router.push(withBasePath('/login'))
```

Keep Next.js `<Link href="/...">` values root-relative because Next applies `basePath` to `Link`. Update middleware comparisons/redirect construction only if its tests or a production build show that `request.nextUrl.pathname` retains `/spite`; prefer stripping one known prefix at middleware entry rather than duplicating every path constant.

- [ ] **Step 6: Verify no unhandled browser API URLs remain**

Run:

```bash
rtk grep -RIn -E "fetch\(['\"]\/api|useSWR[^\n]*['\"]\/api|router\.push\(['\"]\/" services/spite/app services/spite/components
```

Expected: no client-side raw request/router matches except intentionally documented server-side parsing strings.

- [ ] **Step 7: Run SPITE tests and build**

```bash
cd services/spite
NEXT_PUBLIC_BASE_PATH=/spite rtk npx tsx --test lib/base-path.test.ts
NEXT_PUBLIC_BASE_PATH=/spite rtk pnpm build
```

Expected: tests PASS and Next.js build exits 0.

- [ ] **Step 8: Commit SPITE base-path support**

```bash
rtk git add services/spite
rtk git commit -m "feat(spite): support subpath deployment"
```

---

### Task 3: Make Scheduler Safe Under `/scheduler` and Add Its Initial Migration

**Files:**
- Create: `services/free-ai-social-media-scheduler/src/lib/base-path.js`
- Create: `services/free-ai-social-media-scheduler/src/lib/base-path.test.mjs`
- Create: `services/free-ai-social-media-scheduler/prisma/migrations/0001_init/migration.sql`
- Create: `services/free-ai-social-media-scheduler/prisma/migrations/migration_lock.toml`
- Modify: `services/free-ai-social-media-scheduler/next.config.mjs`
- Modify: `services/free-ai-social-media-scheduler/src/lib/auth.js`
- Modify: Scheduler client files returned by `rg 'fetch\("/api|axios\.post\("/api|callbackUrl: "/|href="/' services/free-ai-social-media-scheduler/src`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_BASE_PATH=/scheduler`, `NEXTAUTH_URL=http://PUBLIC_HOST/scheduler`, `DATABASE_URL`, and `DIRECT_URL`.
- Produces: `withBasePath(path, basePath?)`, subpath-safe client/auth URLs, and an initial Prisma migration deployable with `npx prisma migrate deploy`.

- [ ] **Step 1: Write failing scheduler path-helper tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { withBasePath } from './base-path.js';

test('prefixes scheduler URLs once', () => {
  assert.equal(withBasePath('/api/posts', '/scheduler'), '/scheduler/api/posts');
  assert.equal(withBasePath('/scheduler/api/posts', '/scheduler'), '/scheduler/api/posts');
  assert.equal(withBasePath('/', '/scheduler'), '/scheduler');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `rtk node --test services/free-ai-social-media-scheduler/src/lib/base-path.test.mjs`

Expected: FAIL because `base-path.js` does not exist.

- [ ] **Step 3: Implement helper and configure Next.js**

Implement the same no-duplication semantics as SPITE. In `next.config.mjs`, retain existing config and add:

```js
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/$/, '');
const nextConfig = { output: 'standalone', basePath };
```

- [ ] **Step 4: Convert raw Scheduler browser/auth URLs**

Wrap client `fetch` and Axios URLs with `withBasePath()`. Keep Next.js `<Link>` paths unchanged. In `src/lib/auth.js`, set the sign-in page to `withBasePath('/login')`; update explicit `signOut({ callbackUrl: '/login' })` calls to use the helper. `NEXTAUTH_URL` must include `/scheduler` in production.

- [ ] **Step 5: Generate and inspect the initial migration SQL**

Use a temporary empty migration output without connecting to production:

```bash
cd services/free-ai-social-media-scheduler
rtk mkdir -p prisma/migrations/0001_init
rtk npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/0001_init/migration.sql
printf 'provider = "postgresql"\n' > prisma/migrations/migration_lock.toml
```

Inspect the SQL and confirm it creates exactly `Account`, `Session`, `User`, `VerificationToken`, and `ScheduledPost`, including declared indexes, foreign keys, and unique constraints. Do not use `prisma db push` in production.

- [ ] **Step 6: Run helper test and Scheduler build**

```bash
rtk node --test services/free-ai-social-media-scheduler/src/lib/base-path.test.mjs
cd services/free-ai-social-media-scheduler
NEXT_PUBLIC_BASE_PATH=/scheduler NEXTAUTH_URL=http://127.0.0.1/scheduler rtk npm run build
```

Expected: helper test PASS and build exits 0.

- [ ] **Step 7: Commit Scheduler deployment readiness**

```bash
rtk git add services/free-ai-social-media-scheduler
rtk git commit -m "feat(scheduler): support production subpath"
```

---

### Task 4: Build Minimal AMD64 Application Images

**Files:**
- Create: `.dockerignore`
- Create: `services/spite/Dockerfile`
- Create: `services/free-ai-social-media-scheduler/Dockerfile`
- Create: `services/ai-clip/Dockerfile`
- Create: `services/ai-clip/.dockerignore`
- Modify: `Dockerfile`
- Modify: `next.config.mjs`
- Modify: `services/vimax/Dockerfile`

**Interfaces:**
- Consumes: build args `NEXT_PUBLIC_SPITE_URL`, `NEXT_PUBLIC_BASE_PATH`, and runtime environment injected by Compose.
- Produces Docker targets/images: root `web`, root `worker`, root `migrate`, plus standalone SPITE, Scheduler, AI Clip, and ViMax images.

- [ ] **Step 1: Add root context exclusions**

Create `.dockerignore` with at least:

```dockerignore
.git
.next
node_modules
**/node_modules
**/.next
**/.venv
**/__pycache__
**/*.pyc
.env*
!.env.example
!.env.production.example
.superpowers
.bg-shell
services/*/.env*
!services/*/.env.example
services/vimax/.tenants
services/vimax/.vimax
services/ai-clip/output
*.log
.DS_Store
```

- [ ] **Step 2: Enable standalone NexoClip output**

Change `next.config.mjs` without removing `transpilePackages`:

```js
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['studio', 'workflow-builder'],
};
```

- [ ] **Step 3: Refactor the root Dockerfile into reusable targets**

Use pinned `node:20-bookworm-slim` stages to avoid Alpine/native-module incompatibilities. Preserve workspace package manifests before `npm ci`, run `npm run build:packages`, and build NexoClip with `NEXT_PUBLIC_SPITE_URL` available only as a non-secret build arg. Produce:

- `web`: copies `.next/standalone`, `.next/static`, and `public`, runs `node server.js` as non-root, port 3000.
- `worker`: copies runtime `node_modules`, `src`, and needed package artifacts, runs `node src/queue/storyboardWorker.mjs` as non-root.
- `migrate`: copies runtime `node_modules`, `src/db`, and migration SQL, runs `node src/db/migrate.js` as non-root.

Do not put provider keys, database URLs, or runtime tokens in `ARG` or `ENV` instructions.

- [ ] **Step 4: Create SPITE multi-stage Dockerfile**

Use `node:20-bookworm-slim`, Corepack/pnpm with the checked-in lockfile, `pnpm install --frozen-lockfile`, `pnpm build`, and standalone output. Accept only `NEXT_PUBLIC_BASE_PATH` as a build argument. Copy standalone output plus `.next/static` and `public`; run as the built-in `node` user on port 3005 with `HOSTNAME=0.0.0.0` and `PORT=3005`.

- [ ] **Step 5: Create Scheduler multi-stage Dockerfile**

Use `node:20-bookworm-slim`, `npm ci`, `npm run build`, and standalone output. Accept only `NEXT_PUBLIC_BASE_PATH` as a build argument. Ensure Prisma's generated client and required engine are present in the runtime output. Add a `migrate` target that retains Prisma CLI/schema/migrations and runs `npx prisma migrate deploy`; runtime `web` runs as non-root on port 3006.

- [ ] **Step 6: Create CPU-only AI Clip Dockerfile**

Use `python:3.13-slim-bookworm`, install `ffmpeg` and `libgl1` with no recommended packages, install `requirements-local.txt`, create an unprivileged user, and run:

```dockerfile
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "4175"]
```

Set `LOCAL_WHISPER_DEVICE=cpu` and `LOCAL_OUTPUT_DIR=/data/output`; declare `/data/output` as a volume mount in Compose rather than baking generated data into the image.

- [ ] **Step 7: Harden ViMax Dockerfile**

Keep `ghcr.io/astral-sh/uv:python3.13-bookworm-slim`, the frozen lockfile, FFmpeg, and port 4173. Create and switch to a non-root runtime user after dependency installation, ensure `/app/.tenants` is writable by that user, and retain the existing Uvicorn command. Do not introduce CUDA runtime images.

- [ ] **Step 8: Build each image locally for AMD64**

```bash
rtk docker build --platform linux/amd64 --target web -t nexoclip:test .
rtk docker build --platform linux/amd64 --target worker -t nexoclip-worker:test .
rtk docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_BASE_PATH=/spite -t spite:test services/spite
rtk docker build --platform linux/amd64 --build-arg NEXT_PUBLIC_BASE_PATH=/scheduler -t scheduler:test services/free-ai-social-media-scheduler
rtk docker build --platform linux/amd64 -t ai-clip:test services/ai-clip
rtk docker build --platform linux/amd64 -t vimax:test services/vimax
```

Expected: all builds exit 0. If Docker is unavailable locally, record that exact blocker and run the builds on the target VPS before rollout.

- [ ] **Step 9: Verify image architectures and users**

```bash
for image in nexoclip:test nexoclip-worker:test spite:test scheduler:test ai-clip:test vimax:test; do
  rtk docker image inspect "$image" --format '{{.Os}}/{{.Architecture}} user={{.Config.User}}'
done
```

Expected: every line reports `linux/amd64`; application images report a non-empty non-root user.

- [ ] **Step 10: Commit image definitions**

```bash
rtk git add .dockerignore Dockerfile next.config.mjs services/spite/Dockerfile services/free-ai-social-media-scheduler/Dockerfile services/ai-clip/Dockerfile services/ai-clip/.dockerignore services/vimax/Dockerfile
rtk git commit -m "build: add AMD64 production images"
```

---

### Task 5: Define Compose, Caddy Routing, and Environment Contract

**Files:**
- Create: `docker-compose.prod.yml`
- Create: `Caddyfile`
- Create: `.env.production.example`
- Modify: `.gitignore`
- Modify: `tests/deployment/dockerDeployment.test.mjs`

**Interfaces:**
- Consumes: image targets from Task 4 and environment variables documented in `.env.production.example`.
- Produces: a complete Compose graph runnable with `docker compose --env-file .env.production -f docker-compose.prod.yml ...`.

- [ ] **Step 1: Extend the failing deployment contract**

Add assertions that:

- Caddy publishes `${HTTP_PORT:-80}:80` only.
- Redis uses `--requirepass` and an authenticated health check.
- NexoClip/worker use `DATABASE_URL_NEXOCLIP`; SPITE uses `DATABASE_URL_SPITE`; Scheduler uses `DATABASE_URL_SCHEDULER` and `DIRECT_URL_SCHEDULER`.
- ViMax and AI Clip have `/healthz` health checks.
- named volumes include `redis-data`, `vimax-tenants`, `ai-clip-output`, `caddy-data`, and `caddy-config`.
- AI Clip and ViMax do not contain `ports:`.

Run: `rtk node --test tests/deployment/dockerDeployment.test.mjs`

Expected: FAIL until Compose/Caddy are implemented.

- [ ] **Step 2: Create the Caddy routing file**

Use a plain HTTP site while no domain exists:

```caddyfile
:80 {
  encode zstd gzip

  handle_path /ai-clip-api/* {
    reverse_proxy ai-clip:4175
  }

  handle /spite* {
    reverse_proxy spite:3005
  }

  handle /scheduler* {
    reverse_proxy scheduler:3006
  }

  handle {
    reverse_proxy nexoclip:3000
  }
}
```

Order the specific routes before the root fallback. Do not proxy Redis, ViMax, or worker callback routes.

- [ ] **Step 3: Create the production Compose graph**

Define all ten services in the order expected by the contract test. Apply `platform: linux/amd64` to each service. Use one private default network and no host networking.

Key wiring:

```yaml
redis:
  image: redis:7.4-bookworm
  command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD}"]

nexoclip:
  build:
    context: .
    target: web
    args:
      NEXT_PUBLIC_SPITE_URL: /spite
  environment:
    DATABASE_URL: ${DATABASE_URL_NEXOCLIP}
    REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
    AI_CLIP_RUNTIME_URL: http://ai-clip:4175
    VIMAX_RUNTIME_URL: http://vimax:4173

storyboard-worker:
  build:
    context: .
    target: worker
  environment:
    DATABASE_URL: ${DATABASE_URL_NEXOCLIP}
    REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
    VIMAX_RUNTIME_URL: http://vimax:4173
    VIMAX_PROGRESS_CALLBACK_URL: http://storyboard-worker:4180/internal/progress
```

Pass the matching runtime tokens to callers and runtimes. Use `depends_on` health/completion conditions where supported: migrations complete successfully before related web/worker services start; Redis/ViMax/AI Clip become healthy before dependents start. Use `restart: unless-stopped` for long-running services and `restart: "no"` for migrations.

- [ ] **Step 4: Create the placeholder-only environment contract**

Include named variables, grouped by service, with no real values:

```dotenv
HTTP_PORT=80
DATABASE_URL_NEXOCLIP=
DATABASE_URL_SPITE=
DATABASE_URL_SCHEDULER=
DIRECT_URL_SCHEDULER=
REDIS_PASSWORD=
LOCAL_OBJECT_STORAGE_SECRET=
MUAPI_API_KEY=
MUAPI_BASE_URL=https://api.muapi.ai
OPENROUTER_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
BYTEPLUS_API_KEY=
BYTEPLUS_BASE_URL=
VIMAX_RUNTIME_TOKEN=
VIMAX_PROGRESS_TOKEN=
AI_CLIP_RUNTIME_TOKEN=
STORYBOARD_WORKER_CONCURRENCY=1
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=
SPITE_APP_PASSWORD=
SPITE_CRON_SECRET=
FAL_KEY=
SCHEDULER_NEXTAUTH_URL=http://YOUR_VPS_IP/scheduler
SCHEDULER_NEXTAUTH_SECRET=
SCHEDULER_GOOGLE_CLIENT_ID=
SCHEDULER_GOOGLE_CLIENT_SECRET=
SCHEDULER_MUAPIAPP_API_KEY=
SCHEDULER_WEBHOOK_URL=
SCHEDULER_STRIPE_SECRET_KEY=
SCHEDULER_STRIPE_PUBLISHABLE_KEY=
SCHEDULER_STRIPE_WEBHOOK_SECRET=
```

Document which optional provider keys may remain empty and which values must be long random secrets. Add `.env.production` to `.gitignore` and preserve the example exception.

- [ ] **Step 5: Make health checks executable without bloating images**

Use Node's built-in `fetch` for Next.js health checks, Python's `urllib.request` for FastAPI, and `redis-cli -a` for Redis. Do not install curl solely for health checks. Example:

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
```

For authenticated/redirecting app roots, accept any HTTP response below 500 rather than requiring 200.

- [ ] **Step 6: Validate Compose and make the contract GREEN**

```bash
rtk docker compose --env-file .env.production.example -f docker-compose.prod.yml config --quiet
rtk node --test tests/deployment/dockerDeployment.test.mjs
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit orchestration files**

```bash
rtk git add docker-compose.prod.yml Caddyfile .env.production.example .gitignore tests/deployment/dockerDeployment.test.mjs
rtk git commit -m "feat(deploy): orchestrate production stack"
```

---

### Task 6: Add a Safe Deployment Script and Ubuntu Runbook

**Files:**
- Create: `scripts/deploy.sh`
- Create: `docs/deployment/ubuntu-amd64.md`
- Modify: `tests/deployment/dockerDeployment.test.mjs`

**Interfaces:**
- Consumes: `.env.production`, `docker-compose.prod.yml`, Docker Compose v2, and an AMD64 Linux host.
- Produces: `scripts/deploy.sh [--pull]` and a complete operator runbook.

- [ ] **Step 1: Add failing script-contract assertions**

Assert `scripts/deploy.sh`:

- starts with `#!/usr/bin/env bash` and `set -Eeuo pipefail`;
- rejects non-`x86_64` hosts using `uname -m`;
- checks `.env.production` exists and is mode `600` or stricter;
- runs `docker compose ... config --quiet`;
- builds before migrations;
- runs `nexoclip-migrate` and `scheduler-migrate` before `up -d`;
- prints `docker compose ps` at the end.

Run: `rtk node --test tests/deployment/dockerDeployment.test.mjs`

Expected: FAIL because the script does not exist.

- [ ] **Step 2: Implement `scripts/deploy.sh`**

Use one Compose command array to prevent quoting drift:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

[[ "$(uname -m)" == "x86_64" ]] || { echo "This deployment requires x86_64/AMD64." >&2; exit 1; }
[[ -f .env.production ]] || { echo "Copy .env.production.example to .env.production first." >&2; exit 1; }

mode=$(stat -c '%a' .env.production)
(( 10#$mode <= 600 )) || { echo ".env.production must be chmod 600." >&2; exit 1; }

compose=(docker compose --env-file .env.production -f docker-compose.prod.yml)
"${compose[@]}" config --quiet
[[ "${1:-}" != "--pull" ]] || "${compose[@]}" pull --ignore-buildable
"${compose[@]}" build
"${compose[@]}" up -d redis
"${compose[@]}" run --rm nexoclip-migrate
"${compose[@]}" run --rm scheduler-migrate
"${compose[@]}" up -d --remove-orphans
"${compose[@]}" ps
```

Add a clear error trap that prints the failed line without dumping environment variables. Do not run `docker compose down`, prune images, or delete volumes.

- [ ] **Step 3: Write the Ubuntu AMD64 runbook**

Document exact commands for:

1. buying an x86_64 VPS (recommended 16 vCPU/64 GB/300 GB NVMe; minimum 8 vCPU/32 GB/200 GB);
2. installing Docker Engine from Docker's Ubuntu repository and verifying `docker compose version`;
3. configuring UFW for `OpenSSH`, `80/tcp`, and later `443/tcp` only;
4. cloning `https://github.com/cekataiofficial/ai-ugc.git`;
5. creating `.env.production` and running `chmod 600 .env.production`;
6. creating the third Neon `scheduler` database and using three distinct URLs;
7. running `./scripts/deploy.sh`;
8. verifying public paths and authenticated AI Clip behavior;
9. viewing logs and restarting one service;
10. updating with `git pull --ff-only && ./scripts/deploy.sh --pull`;
11. rollback by checking out a known commit and rerunning the script;
12. adding a domain to Caddy and changing Scheduler OAuth/NextAuth URLs;
13. rotating the previously exposed Neon credential before first production deploy.

State explicitly that `.env.production` must never be pasted into tickets/chat or committed.

- [ ] **Step 4: Run script syntax and deployment contract tests**

```bash
rtk bash -n scripts/deploy.sh
rtk node --test tests/deployment/dockerDeployment.test.mjs
```

Expected: both exit 0.

- [ ] **Step 5: Commit deploy automation and documentation**

```bash
rtk chmod +x scripts/deploy.sh
rtk git add scripts/deploy.sh docs/deployment/ubuntu-amd64.md tests/deployment/dockerDeployment.test.mjs
rtk git commit -m "docs(deploy): add Ubuntu AMD64 runbook"
```

---

### Task 7: Full Verification and Push

**Files:**
- Modify only files required to fix verification failures caused by Tasks 1–6.

**Interfaces:**
- Consumes: complete deployment implementation.
- Produces: verified Git commits pushed to `ai-ugc/main`, without staging unrelated work.

- [ ] **Step 1: Run focused unit and static checks**

```bash
rtk node --test tests/deployment/dockerDeployment.test.mjs
cd services/spite && NEXT_PUBLIC_BASE_PATH=/spite rtk npx tsx --test lib/base-path.test.ts
cd ../free-ai-social-media-scheduler && rtk node --test src/lib/base-path.test.mjs
rtk bash -n ../../scripts/deploy.sh
```

Expected: all PASS.

- [ ] **Step 2: Run application builds**

```bash
cd services/spite && NEXT_PUBLIC_BASE_PATH=/spite rtk pnpm build
cd ../free-ai-social-media-scheduler && NEXT_PUBLIC_BASE_PATH=/scheduler NEXTAUTH_URL=http://127.0.0.1/scheduler rtk npm run build
cd ../.. && NEXT_PUBLIC_SPITE_URL=/spite rtk npm run build
```

Expected: SPITE and Scheduler builds exit 0. Record any pre-existing NexoClip page-data failures separately; do not claim the root build passed if it does not.

- [ ] **Step 3: Validate and build the Compose project**

```bash
rtk docker compose --env-file .env.production.example -f docker-compose.prod.yml config --quiet
rtk docker compose --env-file .env.production.example -f docker-compose.prod.yml build
```

Expected: configuration and all image builds exit 0 on an AMD64 Docker host.

- [ ] **Step 4: Inspect architecture and exposure**

```bash
rtk docker compose --env-file .env.production.example -f docker-compose.prod.yml images
rtk docker compose --env-file .env.production.example -f docker-compose.prod.yml config
```

Confirm all built images report AMD64, only Caddy publishes a host port, and output does not contain real credentials.

- [ ] **Step 5: Review Git state and secret safety**

```bash
rtk git diff --check
rtk git status --short
rtk git diff ai-ugc/main...HEAD --stat
rtk git grep -n -I -E '(npg_[A-Za-z0-9]{12,}|sk-or-v1-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)' HEAD -- . ':(exclude)*.lock' ':(exclude)*.lockb' || true
rtk git ls-files | rtk grep -E '(^|/)\.env(\.|$)' || true
```

Expected: no whitespace errors, no staged unrelated files, no real secret patterns, and only example env files tracked.

- [ ] **Step 6: Request final code review**

Invoke `superpowers:requesting-code-review` and review the complete deployment diff against the approved spec. Fix only deployment-scope findings and rerun affected checks.

- [ ] **Step 7: Push verified commits**

```bash
rtk git push ai-ugc main
rtk git ls-remote --heads ai-ugc main
```

Expected: remote `main` points to local `HEAD`.

- [ ] **Step 8: Report deployment handoff**

Report:

- changed files and image/service inventory;
- exact verification commands and outcomes;
- any pre-existing build failures;
- the VPS runbook path;
- reminder to create the Scheduler Neon database, rotate the exposed Neon password, fill `.env.production`, and deploy from an x86_64 Ubuntu host.
