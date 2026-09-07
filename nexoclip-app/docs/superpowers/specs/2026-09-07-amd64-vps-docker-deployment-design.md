# AMD64 VPS Docker Deployment Design

## Goal

Deploy the NexoClip stack to one Ubuntu 24.04 x86_64 VPS with Docker Compose. Keep PostgreSQL on Neon, Cloudflare R2 for object storage, and expose the applications through one HTTP entry point until a domain is available.

## Scope

The production stack contains:

- Caddy reverse proxy
- NexoClip Next.js application
- SPITE Next.js application
- Social Media Scheduler Next.js application
- AI Clip FastAPI runtime
- ViMax FastAPI runtime
- NexoClip storyboard worker
- Redis
- One-shot NexoClip and Scheduler database migration jobs

All Compose services and build outputs target `linux/amd64`. ARM images are out of scope.

## Recommended VPS

Recommended CPU-only production host:

- Ubuntu Server 24.04 LTS
- x86_64/AMD64 processor
- 16 vCPU
- 64 GB RAM
- 300 GB NVMe storage

Practical minimum for initial low traffic:

- 8 vCPU
- 32 GB RAM
- 200 GB NVMe storage

AI Clip performs CPU-heavy Whisper, OpenCV, and FFmpeg work. Its concurrency must remain limited on a CPU-only host. A GPU deployment is explicitly out of scope for this version.

## Public Routing

Until a domain exists, Caddy listens on port 80 and serves the VPS IP:

| Public path | Destination |
| --- | --- |
| `/` | NexoClip on port 3000 |
| `/spite/*` | SPITE on port 3005 |
| `/scheduler/*` | Scheduler on port 3006 |
| `/ai-clip-api/*` | AI Clip on port 4175 |

Only Caddy publishes a host port. Redis, ViMax, worker callbacks, and direct application ports remain inside the Compose network.

Caddy strips `/ai-clip-api` before forwarding because FastAPI exposes `/healthz` and `/internal/v1/*` at its root. AI Clip business endpoints continue to require `AI_CLIP_RUNTIME_TOKEN`; the health endpoint remains unauthenticated.

SPITE and Scheduler are built with Next.js `basePath` values `/spite` and `/scheduler`. Their client-side absolute links and `/api/*` requests must be made base-path aware. NexoClip receives `NEXT_PUBLIC_SPITE_URL=/spite` at build time.

When a domain becomes available, the Caddy site address and public URL environment values are changed, then the web images are rebuilt. Caddy can then provision HTTPS automatically.

## Container Architecture

### Web applications

Each Next.js application uses a multi-stage Dockerfile:

1. dependency installation,
2. application build,
3. minimal non-root runtime.

Next.js standalone output is preferred where compatible, so runtime images contain only the generated server, static assets, and required public files. Build-time public URL values are explicit build arguments; secrets are runtime environment variables and must not appear in image layers.

### NexoClip worker

The worker uses the NexoClip Node image or a dedicated target from the same Dockerfile. It runs `src/queue/storyboardWorker.mjs`, connects to Redis and Neon, calls ViMax internally, and exposes only its internal progress callback port.

### AI Clip

AI Clip uses a Python slim AMD64 image with FFmpeg and the local-mode Python requirements. It runs Uvicorn on `0.0.0.0:4175`, stores temporary processing files in a named volume, and uploads completed media to R2. CPU execution is the default and job concurrency is bounded operationally by running one AI Clip container.

### ViMax

ViMax retains its Python/uv image and installs FFmpeg plus required native libraries. It listens on `0.0.0.0:4173`, remains private, and stores tenant workspaces in a named volume.

### Redis

Redis is private, password-protected, persistent, and configured with append-only persistence. It supports BullMQ and is not treated as the system of record.

## Managed Data Services

Neon remains the PostgreSQL provider. Use separate databases to prevent schema collisions:

- `nexoclip_app` for NexoClip
- `neondb` for SPITE
- `scheduler` for Social Media Scheduler

Each service receives only its own connection string. SPITE uses Cloudflare R2 for assets. AI Clip also uploads outputs to R2. No database or object-storage credential is committed to Git or copied during image builds.

## Configuration and Secrets

The repository contains `.env.production.example` with placeholders only. The operator creates `.env.production` on the VPS with mode `0600`.

Important groups:

- NexoClip database, auth, provider, queue, and internal runtime variables
- SPITE database, R2, generation provider, password, and cron variables
- Scheduler database, NextAuth, Google OAuth, MuAPI, and Stripe variables
- shared strong Redis password
- separate strong runtime tokens for AI Clip, ViMax, and worker progress callbacks

Compose interpolates these values into runtime containers. Public `NEXT_PUBLIC_*` settings are passed as build arguments because Next.js embeds them during compilation.

## Startup and Migrations

Deployment order:

1. validate required production configuration;
2. build AMD64 images;
3. start Redis and wait for readiness;
4. run NexoClip migrations as a one-shot service;
5. run Scheduler Prisma migrations as a one-shot service;
6. start ViMax and AI Clip and wait for health checks;
7. start NexoClip, SPITE, Scheduler, and worker;
8. start/reload Caddy;
9. verify public and internal health checks.

SPITE's existing schema is expected to be initialized in Neon. Its SQL setup is not automatically rerun on every deployment because it is not currently an idempotent migration system.

## Health and Recovery

- AI Clip: `GET /healthz`
- ViMax: `GET /healthz`
- Redis: authenticated `redis-cli ping`
- Next.js apps: HTTP request to their configured base path
- Worker: restart policy plus dependency health; logs are used until a dedicated worker health endpoint is justified
- Restart policy: `unless-stopped` for persistent services

Deployments use `docker compose up -d --build` after successful migrations. A failed migration stops the rollout. Existing containers are not deliberately removed until replacement images are ready.

## Files

Planned additions and focused changes:

- `docker-compose.prod.yml`
- `Caddyfile`
- `.dockerignore`
- `.env.production.example`
- root `Dockerfile`
- `services/spite/Dockerfile`
- `services/free-ai-social-media-scheduler/Dockerfile`
- `services/ai-clip/Dockerfile`
- `services/vimax/Dockerfile`
- `services/spite/next.config.mjs`
- `services/free-ai-social-media-scheduler/next.config.mjs`
- minimal base-path helpers/call-site changes in SPITE and Scheduler
- `scripts/deploy.sh`
- deployment documentation

## Security

- Publish only ports 80 and, later, 443.
- Require AI Clip runtime authentication even though its route is reachable through Caddy.
- Do not expose Redis, ViMax, databases, or worker callback ports.
- Run application containers as non-root where runtime compatibility permits.
- Keep secrets out of build arguments, Dockerfiles, logs, and Git.
- Use restrictive permissions on the VPS environment file.
- Rotate the previously exposed Neon password before deployment.
- Configure Ubuntu firewall access for SSH and HTTP/HTTPS only.

## Verification

Before deployment:

- validate Compose configuration with the example environment;
- build every image for `linux/amd64`;
- run existing unit/type/lint checks relevant to modified files;
- verify no `.env` or secret patterns are tracked;
- inspect the final image architecture;
- inspect the Git diff.

On the VPS:

- confirm every required container is healthy/running;
- verify `/`, `/spite`, `/scheduler`, and `/ai-clip-api/healthz` through Caddy;
- verify unauthorized AI Clip job requests return `401`;
- verify NexoClip reaches its Neon database and Redis;
- submit one controlled non-billable or minimal-cost smoke workflow where available.

## Explicit Non-goals

- ARM64 images
- Kubernetes
- running PostgreSQL in Docker
- GPU/CUDA AI Clip acceleration
- high availability or multi-host orchestration
- automatic SPITE schema migrations
- exposing ViMax or Redis publicly
