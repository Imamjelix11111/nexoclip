# Workflow OpenRouter Engine — Plan 2: Full-Graph Orchestration

**Status:** Design approved, ready for implementation plan. Depends on Plan 1
(`2026-08-19-workflow-openrouter-engine-plan1-design.md`) being complete.

## Problem

Plan 1 lets a user run each workflow node individually via OpenRouter. Plan 2
adds the "Run workflow" action: execute the whole node graph automatically in
dependency order, feeding each node's output into the inputs of the nodes
connected downstream — the core value of a node-based builder.

## What Plan 1 already provides (building blocks)

- A single-node executor (`POST /api/workflow/nodes/run` + poll
  `/api/workflow/nodes/run/[runId]`) that runs one node via OpenRouter,
  persists the output to R2 + `assets`, and reports status through a
  `generation_jobs` row.
- Workflow persistence: the `{nodes, edges}` graph stored as JSONB in the
  `workflows` table.
- The per-model schema catalog.

Plan 2 orchestrates repeated single-node executions over the graph; it does
not re-implement provider calls.

## Architecture

Graph execution runs **server-side** (not driven by the browser looping over
nodes), so a refresh or disconnect does not abandon a partially-run workflow —
consistent with the durable-job approach used everywhere else. A workflow run
is itself a durable job that spawns/depends on per-node `generation_jobs`.

New durable entity: a **workflow run** that owns the ordered execution of its
nodes and records each node's status and output. Reuse `generation_jobs` for
the individual node executions; add a `workflow_runs` row to track the overall
run and the node→output map.

## Components

### 1. Graph model + topological ordering

A pure module (`src/services/workflowGraph.js`, DOM-free, unit-testable):

- Parse `{nodes, edges}` into a dependency graph: an edge from node A's output
  handle to node B's input handle means B depends on A.
- Produce a topological order. Detect and reject cycles with a clear error
  (a node graph must be a DAG).
- For each node, resolve its **effective inputs**: start from the node's own
  `formValues`, then overlay values piped from upstream nodes' outputs
  according to the connected edges (e.g. an upstream Image node's output URL
  becomes the downstream node's `image_url`/`images_list` input; an upstream
  Text node's output text becomes a downstream `prompt`).
- The edge→field mapping is derived from the handle ids already used by the UI
  (e.g. `imageOutput` → `imageInput*`, `textOutput` → `textInput*`), so the
  wiring matches what the user drew.

### 2. Workflow run store

New migration adds `workflow_runs`:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `workspace_id` | UUID FK | tenant scope |
| `workflow_id` | UUID FK → `workflows(id)` | |
| `status` | TEXT | `pending`/`running`/`completed`/`failed`/`canceled` |
| `node_outputs` | JSONB | `{ nodeId: { status, url?/text?, error? } }` |
| `error` | TEXT NULL | overall failure reason |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Index on `(workspace_id, workflow_id)`.

### 3. Orchestrator

- `POST /api/workflow/runs` — body `{workflow_id}` (+ `x-workspace-id`).
  Authenticates, loads the workflow graph, topo-sorts it, creates a
  `workflow_runs` row (`pending`), kicks off server-side execution, returns
  `{run_id}`.
- Execution walks the topological order. For each node:
  1. Resolve effective inputs (own formValues + upstream outputs).
  2. Invoke the Plan 1 single-node execution path (reused directly, not
     re-implemented) and wait for that node's completion.
  3. Record the node's output in `workflow_runs.node_outputs`.
  4. On node failure: mark the run `failed`, record which node failed, and
     stop (downstream nodes that depend on it cannot run). Independent
     branches already completed keep their outputs.
- Nodes with no dependency relationship may run sequentially in Plan 2 (simple,
  predictable). Parallelizing independent branches is an explicit non-goal for
  this plan.
- `GET /api/workflow/runs/[runId]` — poll overall status + the per-node
  output map, so the builder can light up each node as it completes.

### 4. Frontend wiring

- A "Run workflow" button submits `POST /api/workflow/runs` and polls
  `/api/workflow/runs/[runId]`.
- As the poll reports each node completing, the builder updates that node's
  displayed output (reusing the same node-output rendering Plan 1 added).
- A node whose upstream failed shows a "skipped — upstream failed" state.

## Data flow (full run)

1. User clicks "Run workflow".
2. `POST /api/workflow/runs { workflow_id }` → server topo-sorts, creates the
   run, starts executing.
3. Server runs nodes in order, piping outputs to inputs, updating
   `workflow_runs.node_outputs` after each.
4. Browser polls `/api/workflow/runs/[runId]` and lights up nodes as they land.
5. Run ends `completed` (all nodes done) or `failed` (a node failed; downstream
   skipped).

## Error handling

- Cyclic graph → 400 with a clear "workflow has a cycle" message, before any
  execution.
- A node with unmet required inputs (no formValue and no upstream providing it)
  → that node fails with a specific "missing input: <field>" message; the run
  fails at that node.
- Provider failures propagate from the Plan 1 executor as the node's `failed`
  status with a safe message (no upstream URL/token leaked).
- Refresh mid-run: the run keeps executing server-side; the browser
  re-attaches by polling the same `run_id` (persisted per workflow in browser
  storage, like the storyboard durable-job pattern).

## Testing

- `workflowGraph` pure tests: topo order correctness, cycle detection,
  effective-input resolution (upstream output → correct downstream field),
  and the "missing required input" case.
- Orchestrator route tests (injected dependencies): a two-node
  text→image chain runs in order and pipes the text into the image prompt; a
  failing upstream node fails the run and marks downstream skipped; workspace
  isolation on run creation and polling.
- Reuse Plan 1's single-node execution tests unchanged (the orchestrator calls
  that path, it does not duplicate it).

## Non-goals (Plan 2)

- Parallel execution of independent branches (sequential is fine for now).
- Partial re-run / caching of unchanged upstream nodes (every run re-executes;
  optimization can come later).
- Scheduled or triggered runs, run history UI beyond the current run.
- Credit/cost metering (layer on later via the existing credit pipeline).
