# Render deployment

## Prerequisites

- A Render account with access to this Git repository.
- A Neon `DATABASE_URL_SPITE` for Spite web and realtime.
- Cloudflare R2, AI provider, authentication, OAuth, and email credentials currently used in production.
- Render services and data resources created in **Singapore**.

## Blueprint provisioning

1. In Render, choose **New → Blueprint** and select this repository.
2. Render reads the root `render.yaml`; confirm every resource is in Singapore.
3. Confirm `ai-ugc-postgres` is intentionally a **new, empty** NexoClip database. It does not migrate existing production users, projects, media, or jobs.
4. Render provisions `ai-ugc-redis`, private services, workers, and the public `ai-ugc-http` Caddy gateway from the Blueprint.

## Secret checklist

Set every `sync: false` entry in Render's service environment or a Render Secret Group. Never commit these values.

### App and workers

`CANVAS_AUTH_HMAC_SECRET`, `REALTIME_JWT_SECRET`, `REALTIME_TOKEN_SECRET`, `LOCAL_OBJECT_STORAGE_SECRET`, `AI_CLIP_RUNTIME_TOKEN`, `MUAPI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `BYTEPLUS_API_KEY`, `BYTEPLUS_BASE_URL`, `R2_PUBLIC_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `IMAGE_WORKER_CONCURRENCY`, `VIDEO_WORKER_CONCURRENCY`.

Also configure the NexoClip authentication/session, OAuth, email, and any application-specific environment values already required by the production app. They are intentionally not written to Git.

### Spite and realtime

`DATABASE_URL_SPITE` (Neon), `CANVAS_AUTH_HMAC_SECRET`, `CANVAS_AUTH_SECRET`, `REALTIME_JWT_SECRET`, `REALTIME_TOKEN_SECRET`, `SPITE_CRON_SECRET`, `FAL_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `BYTEPLUS_API_KEY`, `BYTEPLUS_BASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_PROXY_SIGNING_SECRET`.

### AI Clip and R2

`AI_CLIP_RUNTIME_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`.

## First deployment sequence

1. Provision the Blueprint data resources and set all required secrets.
2. Deploy `ai-ugc-app`. Its Render `preDeployCommand` runs `node src/db/migrate.js` against `ai-ugc-postgres`; it must complete successfully before the new app revision starts.
3. Verify the private HTTP services: app, Spite, realtime, and AI Clip.
4. Deploy the image and video workers only after the app migration succeeds.
5. Deploy `ai-ugc-http`; it is the only public service and routes `/`, `/spite`, and `/spite/ws` to private services.

## Post-deploy smoke test

1. Confirm `https://<render-gateway>/healthz` returns 200.
2. Confirm `/`, `/spite`, and `/spite/ws` route successfully; the websocket endpoint responds `Welcome to Hocuspocus!` on a plain HTTP request.
3. Confirm public `/api/internal/generations` and `/spite/api/internal/*` return 404.
4. Register or log in with a fresh user.
5. Submit one image and one video generation.
6. Refresh a canvas while generation is active and verify durable recovery and worker completion.

## Rollback and 502 diagnosis

Rollback an individual Render service to a prior deploy; do not delete `ai-ugc-postgres` as a rollback method. A gateway 502 means Caddy cannot reach the relevant private service: inspect that service's latest deploy, health, logs, and internal hostname first. Caddy's `/healthz` proves only that Caddy is alive, not that every upstream is healthy.

## Local validation

```bash
rtk node --test tests/deployment/renderBlueprint.test.mjs \
  tests/deployment/kubernetesRuntime.test.mjs \
  tests/deployment/dockerDeployment.test.mjs

rtk docker build -f deploy/caddy/Dockerfile .
rtk docker build --target web -f nexoclip-app/Dockerfile .
rtk docker build -f deploy/spite/Dockerfile.web .
rtk docker build -f deploy/spite/Dockerfile.realtime .
rtk docker build -f deploy/ai-clip/Dockerfile .
rtk docker build -f deploy/nexoclip/Dockerfile.worker .
```

Local builds prove Docker context compatibility. Render Blueprint validation and Render runtime logs remain authoritative for Render managed-resource references.
