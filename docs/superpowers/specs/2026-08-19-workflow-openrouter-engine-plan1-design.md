# Workflow OpenRouter Engine — Plan 1: Foundation + Single-Node Execution

**Status:** Design approved, ready for implementation plan.

## Problem

The Workflow Studio feature (node-based AI pipeline builder, `packages/Vibe-Workflow`)
is currently 100% dependent on MuAPI at every layer. The Next.js proxy
`app/api/workflow/[[...path]]/route.js` forwards everything —
workflow persistence, node schemas, node execution, and run-status polling —
to `https://api.muapi.ai/workflow/*`. The goal is to make this feature
execute on our own providers (OpenRouter for image/video/text/audio), the
same way Image/Cinema/Video Studio and AI Clipping already do, and drop the
MuAPI dependency.

This is a large subsystem. It is split into two plans:

- **Plan 1 (this spec):** persistence, schema catalog, single-node execution,
  and frontend wiring. After Plan 1 a user can build a workflow, run each node
  individually via OpenRouter, and have results persist.
- **Plan 2 (separate, later):** full-graph orchestration — a "Run workflow"
  button that executes the whole node graph in topological order, piping each
  node's output into downstream nodes' inputs.

## Architecture

Build entirely in Next.js API routes inside `nexoclip-app`. Do **not** stand
up a new Python service. Rationale:

- Persistence uses the existing PostgreSQL database via `pg`, like every other
  feature.
- The OpenRouter image/video routes (`/api/openrouter/images`,
  `/api/openrouter/videos`) already exist and are reused directly by the node
  executor.
- Session+workspace auth, R2 upload (`persistUploadedAsset`,
  `persistGeneratedImage`), and the durable-job pattern are all already in
  Next.js.
- Avoids adding a fourth long-running Python service (we already run
  vimax-runtime and ai-clip).

The Python `vibe-workflow` server and the `app/api/workflow/[[...path]]`
MuAPI proxy are removed / replaced by self-contained Next.js routes.

## Components

### 1. Persistence (PostgreSQL)

New migration adds a `workflows` table:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `workspace_id` | UUID FK → `workspaces(id)` ON DELETE CASCADE | tenant scope |
| `name` | TEXT NOT NULL | |
| `graph` | JSONB NOT NULL | React Flow `{nodes, edges}` stored verbatim |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Index on `workspace_id`.

Routes (all resolve workspace from the authenticated server session via
`resolveTenantContext`, never from client input):

- `GET /api/workflow/definitions` → list workflows for the workspace
  (id, name, updated_at; not the full graph).
- `POST /api/workflow/definitions` → create `{name, graph}` → returns `{id}`.
- `GET /api/workflow/definitions/[id]` → full workflow incl. graph
  (404 if not in this workspace).
- `PUT /api/workflow/definitions/[id]` → update `{name?, graph?}`.
- `DELETE /api/workflow/definitions/[id]`.

A repository module (`src/repositories/workflowRepository.js`) owns the SQL;
a service module (`src/services/workflowService.js`) owns
workspace-ownership checks. Routes stay thin.

### 2. Schema catalog (per model)

A single JS module (`src/services/workflowNodeSchemas.js`) exports the input
schema for each supported OpenRouter model, keyed by the workflow's model id
(the same ids kept in `packages/Vibe-Workflow/.../utility.jsx` after the
OpenRouter filtering already applied). Each entry declares the model's input
fields (`prompt`, `aspect_ratio`, `resolution`, `image_url`, `images_list`,
etc.) with type/title/default — the shape the frontend already reads at
`data.nodeSchemas.categories.<category>.models[id].input_schema.schemas.input_data.properties`.

Reuse the field metadata already encoded in the studio's
`packages/studio/src/models.js` where possible rather than re-authoring it.

- `GET /api/workflow/node-schemas` → returns the full catalog in the shape the
  frontend expects. No auth-sensitive data; may still require a session.

### 3. Single-node executor

- `POST /api/workflow/nodes/run` — body `{model, params, workspaceId via header}`.
  Authenticates session+workspace. Dispatches by the model's category:
  - **image** → call the existing OpenRouter image path
    (`createOpenRouterImageAdapter` / same logic as `/api/openrouter/images`),
    persist output to R2 + `assets`, return `{run_id, status}`.
  - **video** → submit to OpenRouter `/videos`, return `{run_id}` and let the
    client poll (reuse `createOpenRouterVideoAdapter` and the
    `/api/openrouter/videos/[id]` polling+persist logic).
  - **text** → OpenRouter chat completions (small new adapter
    `src/providers/openrouter/textAdapter.js`). Text is fast, so the run is
    created already `completed` with the generated text in its result — the
    client's first poll returns it; no long-poll loop needed.
  - **audio** → OpenRouter audio (lyria for music, gpt-audio for TTS),
    persist to R2, return the run.
- `GET /api/workflow/nodes/run/[runId]` — poll run status; on completion
  returns the output URL(s)/text so the node can display it.
- Model→category and model→OpenRouter-id resolution reuses the existing
  `OPENROUTER_IMAGE_MODEL_MAP` / `OPENROUTER_VIDEO_MODEL_MAP` plus a new
  small audio/text map.

Run state reuses the existing `generation_jobs` durable-job table (as the
studios do) rather than inventing a new store: a workflow node run is a
generation job whose parameters carry the workflow id and node id. This keeps
the video submit/poll/persist path identical to `/api/openrouter/videos`.

### 4. Frontend wiring

In `packages/Vibe-Workflow/packages/workflow-builder`:

- `ImageNode`/`VideoNode`/`TextNode`/`AudioNode` `handleRun` calls
  `POST /api/workflow/nodes/run` (with `x-workspace-id`) instead of
  `/api/workflow/{workflow_id}/node/{node_id}/run`, and polls
  `/api/workflow/nodes/run/[runId]`.
- Node schemas are loaded from `GET /api/workflow/node-schemas`.
- Save / load / list / delete workflow calls target the new
  `/api/workflow/definitions` routes.
- Remove the `app/api/workflow/[[...path]]/route.js` MuAPI proxy once nothing
  references it.

## Data flow (single node run)

1. User fills a node's fields and clicks its run button.
2. Frontend `POST /api/workflow/nodes/run { model, params }` with
   `x-workspace-id`.
3. Route authenticates, resolves model category, calls the matching OpenRouter
   path, persists the output to R2 + `assets`, records a `generation_jobs` row.
4. Frontend polls `/api/workflow/nodes/run/[runId]` until `completed`/`failed`.
5. Node displays the output (image/video/audio URL or text).

## Error handling

- Unauthenticated → 401; no workspace → 403; missing OpenRouter config → 503;
  OpenRouter failure → generic 502 with no upstream URL/token leaked (same
  contract as the existing OpenRouter routes).
- A model id with no OpenRouter mapping → 400 "model not supported" (should not
  happen because the pickers are already filtered, but the executor validates
  defensively).
- Node run failures surface as `status: failed` with a safe message; the node
  shows the error without crashing the builder.

## Testing

- Repository/service unit tests for workflow CRUD (workspace isolation: a
  workspace cannot read/update/delete another's workflow).
- Route tests (injected-handler pattern, like `vimaxSessionsRoute.test.mjs`)
  for definitions CRUD, node-run dispatch per category, and the auth/config
  error contract (401/403/503/502).
- Schema-catalog test: every model id kept in the filtered `utility.jsx`
  pickers has a corresponding entry in `workflowNodeSchemas.js` (no orphan
  model with no schema).

## Non-goals (Plan 1)

- Full-graph "Run workflow" orchestration (topological execution, output→input
  piping) — that is Plan 2.
- Audio node beyond a basic lyria/gpt-audio call (no Suno-style
  extend/remix/voice-clone — no OpenRouter equivalent).
- The removed Api node (already deleted from the palette).
- Cost/credit metering of node runs (can be layered on later via the existing
  credit pipeline).
