FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/Vibe-Workflow/packages/workflow-builder/package*.json ./packages/Vibe-Workflow/packages/workflow-builder/
COPY packages/Open-Poe-AI/packages/agents/package*.json ./packages/Open-Poe-AI/packages/agents/
COPY packages/Open-AI-Design-Agent/packages/design-agent/package*.json ./packages/Open-AI-Design-Agent/packages/design-agent/
COPY packages/studio/package*.json ./packages/studio/
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci

FROM deps AS builder
ARG NEXT_PUBLIC_SPITE_URL=/spite
ENV NEXT_PUBLIC_SPITE_URL=$NEXT_PUBLIC_SPITE_URL
COPY . .
# Next imports database-backed route modules while collecting build metadata.
# This non-routable URL satisfies configuration checks without exposing a secret.
RUN npm run build:packages \
 && DATABASE_URL=postgresql://build:build@127.0.0.1:1/build npm run build

FROM node:20-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:20-bookworm-slim AS node-runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
USER node

FROM node-runtime AS worker
CMD ["node", "src/queue/storyboardWorker.mjs"]

FROM node-runtime AS migrate
CMD ["node", "src/db/migrate.js"]
