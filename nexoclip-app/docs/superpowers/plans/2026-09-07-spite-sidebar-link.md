# SPITE Sidebar Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI Canvas Mode sidebar item with a same-tab link to the separately hosted SPITE service.

**Architecture:** Keep the existing workflow studio and routes intact, but replace only their dedicated sidebar shortcut with an external anchor. Resolve the destination from `NEXT_PUBLIC_SPITE_URL`, falling back to `http://localhost:3005`.

**Tech Stack:** Next.js App Router, React, environment variables.

## Global Constraints

- Keep the current sidebar position and icon.
- Navigate in the same browser tab with a normal anchor.
- Configure `NEXT_PUBLIC_SPITE_URL=http://localhost:3005` in `.env.example` and ignored `.env.local`.
- Do not modify SPITE, authentication, databases, or the OpenRouter migration.
- Preserve unrelated working-tree changes.

---

### Task 1: Replace the AI Canvas shortcut with SPITE

**Files:**
- Modify: `components/StandaloneShell.js`
- Modify: `.env.example`
- Modify (ignored): `.env.local`

**Interfaces:**
- Consumes: `process.env.NEXT_PUBLIC_SPITE_URL`.
- Produces: a sidebar anchor labeled `SPITE` whose destination defaults to `http://localhost:3005`.

- [ ] **Step 1: Capture the current failing static assertions**

Run:

```bash
rtk node - <<'NODE'
const fs = require('fs')
const shell = fs.readFileSync('components/StandaloneShell.js', 'utf8')
if (!shell.includes("label: 'SPITE'")) throw new Error('SPITE sidebar label missing')
if (!shell.includes("process.env.NEXT_PUBLIC_SPITE_URL || 'http://localhost:3005'")) throw new Error('SPITE URL config missing')
if (shell.includes("label: 'AI Canvas Mode'")) throw new Error('legacy AI Canvas label remains')
NODE
```

Expected: FAIL because SPITE is not yet configured in the sidebar.

- [ ] **Step 2: Implement the minimal sidebar change**

In `components/StandaloneShell.js`:

- Define `const SPITE_URL = process.env.NEXT_PUBLIC_SPITE_URL || 'http://localhost:3005'` near the tab configuration.
- Change the existing `workflows` tab label from `AI Canvas Mode` to `SPITE` while preserving its icon.
- Render that dedicated shortcut as `<a href={SPITE_URL}>` without the internal `handleNavigationItemClick` handler.
- Leave internal workflow rendering and deep links intact for backward compatibility.

- [ ] **Step 3: Add environment values**

Append to `.env.example` and `.env.local`:

```dotenv
# External SPITE canvas service shown in the NexoClip sidebar.
NEXT_PUBLIC_SPITE_URL=http://localhost:3005
```

Do not stage `.env.local`.

- [ ] **Step 4: Verify behavior and build**

Run:

```bash
rtk node - <<'NODE'
const fs = require('fs')
const shell = fs.readFileSync('components/StandaloneShell.js', 'utf8')
if (!shell.includes("label: 'SPITE'")) throw new Error('SPITE sidebar label missing')
if (!shell.includes("process.env.NEXT_PUBLIC_SPITE_URL || 'http://localhost:3005'")) throw new Error('SPITE URL config missing')
if (shell.includes("label: 'AI Canvas Mode'")) throw new Error('legacy AI Canvas label remains')
for (const file of ['.env.example', '.env.local']) {
  if (!fs.readFileSync(file, 'utf8').includes('NEXT_PUBLIC_SPITE_URL=http://localhost:3005')) throw new Error(`${file} missing SPITE URL`)
}
console.log('SPITE sidebar configuration verified')
NODE
rtk npm run build
rtk git diff -- components/StandaloneShell.js .env.example
rtk git check-ignore .env.local
```

Expected: static assertions and build pass; `.env.local` remains ignored.

- [ ] **Step 5: Commit tracked files only**

```bash
rtk git add components/StandaloneShell.js .env.example
rtk git commit -m "feat(nav): replace AI Canvas with SPITE"
```
