FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package*.json ./
COPY packages/Vibe-Workflow/packages/workflow-builder/package*.json ./packages/Vibe-Workflow/packages/workflow-builder/
COPY packages/Open-Poe-AI/packages/agents/package*.json ./packages/Open-Poe-AI/packages/agents/
COPY packages/Open-AI-Design-Agent/packages/design-agent/package*.json ./packages/Open-AI-Design-Agent/packages/design-agent/
COPY packages/studio/package*.json ./packages/studio/
RUN npm install

# Build sub-packages
FROM deps AS builder
COPY . .
RUN npm run build:packages
RUN npm run build

# Production runner
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src/db ./src/db
COPY --from=builder /app/src/queue ./src/queue
COPY --from=builder /app/scripts/production-config.mjs ./scripts/production-config.mjs
COPY --from=builder /app/scripts/worker-recover.mjs ./scripts/worker-recover.mjs

EXPOSE 3000
CMD ["npm", "start"]
