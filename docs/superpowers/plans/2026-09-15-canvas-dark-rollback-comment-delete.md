# Canvas Dark Rollback and Comment Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the previous dark Canvas controls, remove Notes, and make Comment deletion stay inside the Canvas without navigating to an error page.

**Architecture:** Use targeted historical restoration rather than reverting the whole feature range: restore the left toolbar and Canvas workspace from the last pre-Notes commit, restore Jobs from the last pre-Sand commit, then retain current non-visual features explicitly. Fix Comment deletion at the button boundary while continuing to use the existing collaborative `deleteNodes` command.

**Tech Stack:** Next.js 16, React 19, TypeScript, React Flow, Yjs/Hocuspocus, Tailwind CSS, Node test runner with `tsx`, Docker Compose.

## Global Constraints

- Remove Full Sand styling from the left toolbar, compact/expanded Assets panels, and Jobs panel.
- Remove Notes completely: tool, node registration, placement path, component, and tests.
- Preserve realtime mention synchronization and caret-anchored mention suggestions.
- Preserve exact uploaded filename labels and Character/Prop/Location folder-name overwrite behavior.
- Preserve shortened durable Job IDs, full UUID copying, generation statuses, and regeneration feedback.
- Comment deletion must invoke the collaborative `deleteNodes([id])` command exactly once without submitting a form, navigating, dragging, or selecting.
- Do not add dependencies or database migrations.
- Rebuild Docker without `down -v`; preserve PostgreSQL, Redis, asset, and application volumes.
- Do not include `skills-lock.json`, `.superpowers/brainstorm/`, `nexoclip-app/se4w/`, personal deployment documents, `json.json`, `skill-prompt.txt`, or `to_json.py` in commits.

---

## File Structure

### Create

- `nexoclip-app/services/spite/lib/comment-delete.test.ts` — source-boundary regression test for safe collaborative Comment deletion.
- `nexoclip-app/services/spite/lib/canvas-dark-rollback.test.ts` — verifies Sand/Notes removal while preserving naming, mention, and Job tracing features.

### Modify

- `nexoclip-app/services/spite/components/canvas/nodes/comment-node.tsx` — make the hover X a non-submitting, propagation-safe action.
- `nexoclip-app/services/spite/components/canvas/left-toolbar.tsx` — restore pre-Notes/pre-Sand dark toolbar and Assets UI.
- `nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx` — remove Note registration, active tool, placement, and initial data.
- `nexoclip-app/services/spite/components/canvas/jobs-panel.tsx` — restore pre-Sand dark visuals while retaining durable ID controls and button safety.

### Delete

- `nexoclip-app/services/spite/components/canvas/nodes/note-node.tsx`
- `nexoclip-app/services/spite/lib/note-node.test.ts`
- `nexoclip-app/services/spite/lib/canvas-sand.test.ts`

---

### Task 1: Fix Comment Delete Button Navigation

**Files:**
- Create: `nexoclip-app/services/spite/lib/comment-delete.test.ts`
- Modify: `nexoclip-app/services/spite/components/canvas/nodes/comment-node.tsx`

**Interfaces:**
- Consumes: `useCanvasCollaboration().deleteNodes(ids: string[]): void`
- Produces: a safe Comment delete button with `type="button"`, pointer/click propagation guards, and one `deleteNodes([id])` call.

- [ ] **Step 1: Write the failing Comment delete boundary test**

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../components/canvas/nodes/comment-node.tsx', import.meta.url),
  'utf8',
)

test('Comment delete is a non-submitting collaborative action', () => {
  const button = source.slice(source.indexOf('<button'), source.indexOf('</button>') + 9)
  assert.match(button, /type="button"/)
  assert.match(button, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/)
  assert.match(button, /onClick=\{\(e\) => \{/)
  assert.match(button, /e\.preventDefault\(\)/)
  assert.match(button, /e\.stopPropagation\(\)/)
  assert.match(button, /deleteNodes\(\[id\]\)/)
  assert.equal((button.match(/deleteNodes\(\[id\]\)/g) || []).length, 1)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/comment-delete.test.ts
```

Expected: FAIL because the current button has no `type="button"`, pointer-down guard, or `preventDefault()`.

- [ ] **Step 3: Apply the minimal button-boundary fix**

```tsx
<button
  type="button"
  onPointerDown={(event) => event.stopPropagation()}
  onClick={(event) => {
    event.preventDefault()
    event.stopPropagation()
    deleteNodes([id])
  }}
  aria-label="Delete comment"
  title="Delete comment"
>
```

Keep the current hover styling and collaborative command unchanged.

- [ ] **Step 4: Run Comment and Canvas interaction tests**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/comment-delete.test.ts lib/canvas-node-interactions.test.ts lib/realtime/react-flow-binding.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit the Comment fix**

```bash
rtk git add \
  nexoclip-app/services/spite/components/canvas/nodes/comment-node.tsx \
  nexoclip-app/services/spite/lib/comment-delete.test.ts
rtk git commit -m "fix(canvas): keep comment deletion in canvas"
```

---

### Task 2: Remove Notes and Restore Dark Left Controls

**Files:**
- Create: `nexoclip-app/services/spite/lib/canvas-dark-rollback.test.ts`
- Modify: `nexoclip-app/services/spite/components/canvas/left-toolbar.tsx`
- Modify: `nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx`
- Delete: `nexoclip-app/services/spite/components/canvas/nodes/note-node.tsx`
- Delete: `nexoclip-app/services/spite/lib/note-node.test.ts`
- Delete: `nexoclip-app/services/spite/lib/canvas-sand.test.ts`

**Interfaces:**
- Preserves active tools: `'select' | 'cut' | 'sticker' | 'comment'`
- Removes node type: `note`
- Preserves `uploadedMediaLabel(file.name)`, `MentionTextarea`, and existing collaborative commands.

- [ ] **Step 1: Write the failing rollback boundary test**

```ts
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const toolbar = read('../components/canvas/left-toolbar.tsx')
const workspace = read('../components/canvas/canvas-workspace.tsx')
const mention = read('../components/canvas/mention-textarea.tsx')

 test('dark controls remove Sand and Notes while preserving current features', () => {
  assert.doesNotMatch(toolbar, /--sand-/)
  assert.doesNotMatch(toolbar, /id:\s*'note'/)
  assert.doesNotMatch(workspace, /NoteNode|activeTool === 'note'|note:\s*NoteNode/)
  assert.equal(existsSync(new URL('../components/canvas/nodes/note-node.tsx', import.meta.url)), false)
  assert.match(workspace, /uploadedMediaLabel\(file\.name\)/)
  assert.match(mention, /placeMentionMenu/)
})
```

Remove the accidental leading space before `test` when writing the actual file.

- [ ] **Step 2: Run the rollback test and verify RED**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/canvas-dark-rollback.test.ts
```

Expected: FAIL because Sand variables and Notes currently exist.

- [ ] **Step 3: Restore the last pre-Notes/pre-Sand toolbar and workspace**

From the repository root:

```bash
rtk git restore --source=d485868 -- \
  nexoclip-app/services/spite/components/canvas/left-toolbar.tsx \
  nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx
```

Commit `d485868` is the completed deterministic-naming task immediately before Notes. It retains exact upload naming and folder naming while removing Notes and all later Sand changes from these two files.

- [ ] **Step 4: Delete Note and Sand-only files**

```bash
rtk rm \
  nexoclip-app/services/spite/components/canvas/nodes/note-node.tsx \
  nexoclip-app/services/spite/lib/note-node.test.ts \
  nexoclip-app/services/spite/lib/canvas-sand.test.ts
```

- [ ] **Step 5: Run rollback, naming, mention, and realtime tests**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test \
  lib/canvas-dark-rollback.test.ts \
  lib/canvas-media-label.test.ts \
  lib/mention-state.test.ts \
  lib/mention-position.test.ts \
  lib/realtime/react-flow-binding.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit Notes removal and dark toolbar restoration**

```bash
rtk git add -A \
  nexoclip-app/services/spite/components/canvas/left-toolbar.tsx \
  nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx \
  nexoclip-app/services/spite/components/canvas/nodes/note-node.tsx \
  nexoclip-app/services/spite/lib/note-node.test.ts \
  nexoclip-app/services/spite/lib/canvas-sand.test.ts \
  nexoclip-app/services/spite/lib/canvas-dark-rollback.test.ts
rtk git commit -m "revert(canvas): remove Notes and Sand toolbar"
```

---

### Task 3: Restore Dark Jobs Panel Without Losing Job IDs

**Files:**
- Modify: `nexoclip-app/services/spite/components/canvas/jobs-panel.tsx`
- Modify: `nexoclip-app/services/spite/lib/canvas-dark-rollback.test.ts`
- Test: `nexoclip-app/services/spite/lib/job-tracing.test.ts`

**Interfaces:**
- Consumes: `resolveDurableJobId(data)` and `shortJobId(id)` from `lib/job-tracing.ts`
- Preserves: sibling main-focus and copy buttons, full UUID clipboard copy, Sonner success/failure notifications.

- [ ] **Step 1: Extend the failing rollback test for Jobs**

```ts
const jobs = read('../components/canvas/jobs-panel.tsx')

assert.doesNotMatch(jobs, /--sand-/)
assert.match(jobs, /resolveDurableJobId/)
assert.match(jobs, /shortJobId/)
assert.match(jobs, /navigator\.clipboard\.writeText\(job\.generationId!\)/)
assert.match(jobs, /type="button"/)
```

- [ ] **Step 2: Run the test and verify RED**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/canvas-dark-rollback.test.ts
```

Expected: FAIL because Jobs still contains `--sand-*` variables.

- [ ] **Step 3: Restore the pre-Sand Jobs implementation**

From the repository root:

```bash
rtk git restore --source=78e1270 -- \
  nexoclip-app/services/spite/components/canvas/jobs-panel.tsx
```

Commit `78e1270` contains durable Job IDs immediately before Full Sand styling.

Then retain the final safety fix by adding `type="button"` to the main JobRow focus button:

```tsx
<button
  type="button"
  onClick={onClick}
  className="min-w-0 flex-1 text-left"
>
```

Do not alter the sibling copy button or Job ID helpers.

- [ ] **Step 4: Run Jobs, rollback, and generation tests**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test \
  lib/canvas-dark-rollback.test.ts \
  lib/job-tracing.test.ts \
  lib/generation-node.test.ts \
  lib/generation-feedback.test.ts \
  lib/durable-generation.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit dark Jobs restoration**

```bash
rtk git add \
  nexoclip-app/services/spite/components/canvas/jobs-panel.tsx \
  nexoclip-app/services/spite/lib/canvas-dark-rollback.test.ts
rtk git commit -m "revert(canvas): restore dark Jobs panel"
```

---

### Task 4: Full Verification and Docker Rebuild

**Files:**
- Modify only files required by regressions directly caused by Tasks 1–3.

**Interfaces:**
- Produces a tested local `main` release and refreshed Compose containers.

- [ ] **Step 1: Confirm rollback scope in the repository**

```bash
rtk rg -n -- '--sand-|NoteNode|activeTool === .note.|note: NoteNode' \
  nexoclip-app/services/spite/components/canvas \
  nexoclip-app/services/spite/lib
```

Expected: no production registration/style matches. Historical design/plan documents are outside this search and may retain the terms.

- [ ] **Step 2: Run the full Spite test suite**

```bash
cd nexoclip-app/services/spite
rtk npm test
```

Expected: zero failures. The DOM caret test may remain skipped when `jsdom` is unavailable.

- [ ] **Step 3: Run the Spite production build**

```bash
cd nexoclip-app/services/spite
rtk npm run build
```

Expected: build and TypeScript checks pass. Restore `next-env.d.ts` if Next rewrites generated route-type imports.

- [ ] **Step 4: Verify repository scope and request final review**

```bash
rtk proxy git diff --check
rtk git status --short
```

Expected: no whitespace errors and no unrelated files staged/committed. Review the complete implementation for Comment event safety, historical-restore scope, preserved Job ID controls, and absence of Notes/Sand runtime code.

- [ ] **Step 5: Rebuild Docker without removing volumes**

```bash
rtk docker compose up -d --build
```

Do not run `docker compose down -v`.

- [ ] **Step 6: Verify local runtime health**

```bash
rtk docker compose ps
rtk curl http://localhost/spite/healthz
rtk curl http://localhost/api/auth/session
```

Expected:

- persistent services are running;
- PostgreSQL, Redis, realtime, and AI Clip report healthy;
- `/spite/healthz` returns `{"ok":true}`;
- unauthenticated `/api/auth/session` may return `{"authenticated":false}`.

- [ ] **Step 7: Manual acceptance**

1. Open an existing Canvas project.
2. Confirm the toolbar, Assets panels, and Jobs panel use the previous dark visuals.
3. Confirm no Notes tool is present.
4. Add a Comment, hover it, and click X.
5. Confirm the Comment disappears and the Canvas remains loaded.
6. Confirm a generated/uploaded node still retains naming behavior.
7. Confirm Jobs still shows a shortened copyable durable ID.
8. Confirm typing `@` still opens suggestions at the caret.

Expected: all eight checks pass without data loss or page navigation.
