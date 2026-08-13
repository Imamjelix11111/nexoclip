# NexoClip SaaS — Agent Instructions

This file is the local handoff for Pi, Claude, and other coding agents working in this repository.

## 1. Project identity

- Product: NexoClip SaaS
- Repository: `Open-Generative-AI`
- Local path: `/Users/lovinsmwn/Documents/production/nexoclip/Open-Generative-AI`
- Product direction: an AI content workflow/platform, not a single-model or avatar-only wrapper.
- Current primary inference provider: MuAPI.
- Database decision: raw PostgreSQL using `pg`, SQL, and application migrations.
- Do not introduce Supabase database dependencies unless the user explicitly changes this decision.

## 2. Source of truth

Use both sources, for different purposes:

1. **Repository** = source of truth for actual code and implementation state.
2. **Notion** = source of truth for product decisions, architecture, milestones, and task state.

Important Notion resources:

- Parent: [NexoClip — SaaS Open Generative AI](https://app.notion.com/p/3b96cf4e027c81c896a3f9c900f68bf5?pvs=204)
- Task board: [NexoClip Sprint Task Board](https://app.notion.com/p/41ec9426e87b4502bb2c9d4cb64138ab?pvs=204)
- ERD: [ERD & Database Architecture](https://app.notion.com/p/3b96cf4e027c81b6ab88e455ae5e8ba2?pvs=204)
- Generation/cost: [Generation & Cost Control Architecture](https://app.notion.com/p/3b96cf4e027c81a1bbf4df6027e491dd?pvs=204)
- Database: [Raw PostgreSQL Schema & Migration Plan](https://app.notion.com/p/3b96cf4e027c81c4830cc69875f9ceee?pvs=204)
- Backend: [Backend & API Architecture](https://app.notion.com/p/3b96cf4e027c81a789c3c69e4d95f16c?pvs=204)
- Runbook: [Implementation Runbook & Context Handoff](https://app.notion.com/p/3b96cf4e027c817c9bf1d94b735786b5?pvs=204)

If Notion and code disagree:

- Trust the repository for facts about what currently exists.
- Trust Notion for intended architecture and product decisions.
- Do not silently change an architecture decision; report the discrepancy and ask when it affects scope or security.

## 3. Fresh-context startup procedure

Before changing code:

1. Read this file and `CLAUDE.md` if present.
2. Check repository state with `rtk git status`; preserve unrelated user changes.
3. Inspect package scripts and the relevant directory before editing.
4. Read the Notion task board and find tasks with status `In progress`.
5. If no task is `In progress`, select the highest-priority `P0` task in the active sprint.
6. Fetch the relevant Notion architecture page before implementation.
7. Confirm the task's acceptance criteria and dependencies.
8. Write a short implementation plan listing files, tests, and risks.
9. Implement the smallest complete change.
10. Run relevant verification commands.
11. Review the diff.
12. Update the Notion task status and implementation note.
13. Report changed files, verification evidence, and blockers.

Do not start a later sprint while a prerequisite milestone is incomplete unless the user explicitly requests it.

## 4. Current task state

The task board is initialized with Sprint 1–3 and milestones M1–M3. Tasks begin as `Not started` unless the Notion board says otherwise.

Default first task:

> **S1 — Audit existing MuAPI proxy and BYOK flow**

First task checklist:

- Map every route under `app/api`.
- Find frontend and server MuAPI calls.
- Find all API-key reads, including `localStorage`, `Authorization`, and `x-api-key`.
- Document `middleware.js` rewrites and compatibility behavior.
- Identify the first workflow suitable for SaaS migration.
- Record secret-exposure risks and minimum safe migration changes.
- Do not change production behavior before the audit is complete.

## 5. Product and architecture decisions

### Runtime boundary

```text
Browser
  -> Next.js App Router / Route Handlers
  -> auth + tenant authorization
  -> services
  -> repositories
  -> raw PostgreSQL
  -> external queue
  -> persistent worker
  -> MuAPI adapter
  -> object storage
```

Next.js/serverless handles short requests, auth, CRUD, cost estimation, credit reservation, job creation, signed URLs, and status reads.

A persistent worker handles MuAPI submission, polling, retry, long-running generation, output persistence, provider usage, and credit settlement.

Never wait for a multi-minute MuAPI or video process inside a serverless request.

### Backend layering

```text
Route Handler -> auth/input validation -> service -> repository -> PostgreSQL
```

- Route handlers are HTTP boundaries.
- Services own business rules and transaction composition.
- Repositories own SQL and row mapping.
- Providers are accessed through adapters.
- SQL must not be scattered through route handlers.

### Data rules

- Every business resource is tenant-scoped by `workspace_id`.
- Never trust a client-provided `workspace_id` as authorization.
- Verify workspace membership and role before resource access.
- Binary image/video/audio belongs in object storage; PostgreSQL stores metadata and storage keys.
- Credit accounting uses an append-only ledger.
- Reservation, job creation, capture, release, and refund must be transactional and idempotent.
- Provider-specific details must stay inside the MuAPI adapter.

### Secret rules

- Central MuAPI credentials are server/worker-only.
- Never put provider secrets in browser code, `localStorage`, Notion, git, logs, or chat.
- Never echo secrets in errors or test snapshots.
- Use `.env.example` placeholders only.

## 6. Existing repository areas

Important current areas:

```text
app/api/                         Existing route handlers and MuAPI compatibility routes
packages/studio/                 Main studio client and model integration
packages/studio/src/muapi.js     Main MuAPI client
packages/studio/src/models.js    Model registry
src/                             Shared server/client utilities
components/                      UI components
middleware.js                    Security headers and MuAPI rewrites
```

Existing API routes are primarily MuAPI proxies/BYOK compatibility. Do not delete or broadly rewrite them during SaaS migration.

New SaaS backend should be added incrementally under:

```text
app/api/auth/
app/api/workspaces/
app/api/projects/
app/api/assets/
app/api/generations/
app/api/credits/
app/api/billing/
app/api/admin/

src/db/
src/repositories/
src/services/
src/providers/muapi/
src/queue/
worker/
```

## 7. Sprint and milestone map

### M1 — SaaS Foundation / Sprint 1

- Audit existing MuAPI proxy and BYOK flow.
- Decide authentication and session provider.
- Set up raw PostgreSQL development environment.
- Implement migration runner and initial schema.
- Implement workspace membership and tenant context.
- Create repository and service boundaries.
- Add workspace/project/product API.
- Create object-storage upload and signed URL flow.
- Seed plans, provider registry, and development data.

Exit condition: tenant-safe SaaS foundation exists without breaking compatibility routes.

### M2 — Generation Pipeline / Sprint 2

- Implement credit account and append-only ledger.
- Implement cost estimator and pricing versioning.
- Implement generation job and step creation API.
- Add queue publisher and recovery scanner.
- Build persistent worker runtime.
- Implement MuAPI provider adapter.
- Implement retry, timeout, and job state machine.
- Persist generation outputs and provider usage.

Exit condition: one workflow runs end-to-end asynchronously.

### M3 — Monetization & Hardening / Sprint 3

- Implement capture, release, refund, and reconciliation.
- Implement subscription and billing webhooks.
- Add rate, concurrency, and budget limits.
- Add admin usage/job/credit views.
- Add tenant isolation and failure integration tests.
- Migrate one real workflow from BYOK to SaaS generation API.

Exit condition: MVP is ready for controlled beta.

## 8. How to retrieve Notion knowledge

Notion is connected through OAuth MCP. Do not use or request secrets in chat.

When Notion tools are available:

1. Search workspace content with `notion-search` using:
   - `query_type: "internal"`
   - `content_search_mode: "workspace_search"`
   - `filters: {}`
2. Search one topic at a time, for example:
   - `"NexoClip generation cost credits"`
   - `"NexoClip raw PostgreSQL schema"`
   - `"NexoClip sprint task board"`
3. Use the result's `url`, not a guessed raw ID.
4. Fetch the page with `notion-fetch`.
5. For the task database, fetch the database first to obtain its data-source URL/schema.
6. Query task rows using the data source or relevant saved view.
7. Inspect `Status`, `Sprint`, `Milestone`, `Priority`, and `Effort` before selecting work.
8. Update the task page after implementation; do not only report status in chat.

If MCP is unavailable, continue from the URLs and this local file, but state that Notion verification was unavailable. Do not invent task state.

## 9. Task update protocol

For a task being worked on:

1. Set `Status` to `In progress` before coding.
2. Add an implementation note to the task page.
3. Keep the note concise but concrete:

```text
Implementation note:
- What changed:
- Files:
- Tests:
- Verification:
- Blockers:
- Follow-up:
```

4. Set `Status` to `Done` only after acceptance criteria and verification are complete.
5. If blocked, leave the task `In progress` and record the exact blocker.
6. Never mark work done based only on code being written.

## 10. Verification requirements

Before claiming completion:

- Run the relevant project check/test/lint command.
- For database work, test migration from an empty database where possible.
- For tenant work, test cross-tenant denial.
- For credit work, test concurrent mutation and idempotency.
- For queue/worker work, test duplicate claim prevention and restart recovery.
- Review `rtk git diff`.
- Confirm no secrets are present in the diff.

Evidence before assertion: state the actual command and result.

## 11. Open decisions

Do not silently choose these for production:

- Auth provider and session implementation.
- Managed PostgreSQL provider: Neon, AWS RDS, Railway, or self-hosted.
- Queue provider and worker deployment.
- Object-storage provider.
- Indonesian payment provider.
- MuAPI commercial/resale/white-label terms.
- Actual MuAPI cost per workflow.
- Credit pricing and plan quotas.
- Whether PostgreSQL RLS is needed for MVP.

For an MVP prototype, propose the simplest reversible option and label it as a decision, not a fact.

## 12. Handoff instruction

If context is fresh, start with:

> Read `AGENTS.md`, inspect `git status`, check the Notion task board for `In progress`, fetch the relevant architecture page, and continue the highest-priority active task. If no task is active, start `S1 — Audit existing MuAPI proxy and BYOK flow`. Use Next.js for short serverless requests, raw PostgreSQL with `pg`, and a persistent worker for generation. Preserve compatibility routes. Never expose secrets.
