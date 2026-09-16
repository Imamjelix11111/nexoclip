# Mention Popup Above Caret Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place the mention suggestion dropdown 8px above the active caret while accepting valid zero-width collapsed caret geometry.

**Architecture:** Keep the existing body portal and fixed viewport coordinates. Add a pure caret-geometry validator and make the pure placement helper prefer above, then use both from `MentionTextarea` before falling back to the editor rectangle.

**Tech Stack:** Next.js 16, React 19, TypeScript, DOM Range APIs, Node test runner with `tsx`, Docker Compose.

## Global Constraints

- Popup appears 8px above the active `@query` caret when space permits.
- Popup falls below only when it cannot fit above the 8px viewport margin.
- A zero-width collapsed caret with finite coordinates and positive height is valid.
- All-zero or non-finite caret geometry falls back to the editor rectangle.
- Popup stays clamped to an 8px viewport margin.
- Preserve body portal, fixed positioning, keyboard controls, click insertion, mention metadata sync, and caret restoration.
- Do not add dependencies, migrations, or unrelated styling.
- Rebuild Docker without removing PostgreSQL, Redis, asset, or application volumes.
- Do not commit unrelated local files including `skills-lock.json`, `.superpowers/brainstorm/`, `nexoclip-app/se4w/`, personal deployment documents, `json.json`, `skill-prompt.txt`, or `to_json.py`.

---

### Task 1: Correct Caret Geometry and Prefer Above Placement

**Files:**
- Modify: `nexoclip-app/services/spite/lib/mention-position.ts`
- Modify: `nexoclip-app/services/spite/lib/mention-position.test.ts`
- Modify: `nexoclip-app/services/spite/components/canvas/mention-textarea.tsx`

**Interfaces:**
- Produces: `isUsableCaretRect(rect: { left: number; right: number; top: number; bottom: number; width: number; height: number }): boolean`
- Preserves: `placeMentionMenu(caret, menu, viewport, gap?): { left: number; top: number; placement: 'above' | 'below' }`
- Consumes: `Range.getBoundingClientRect()` and `HTMLElement.getBoundingClientRect()`.

- [ ] **Step 1: Replace the existing placement tests with failing prefer-above and geometry cases**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'

import { isUsableCaretRect, placeMentionMenu } from './mention-position'

test('places the menu eight pixels above a caret when space permits', () => {
  assert.deepEqual(
    placeMentionMenu(
      { left: 500, right: 500, top: 400, bottom: 420 },
      { width: 240, height: 180 },
      { width: 1200, height: 800 },
    ),
    { left: 500, top: 212, placement: 'above' },
  )
})

test('accepts a zero-width collapsed caret with usable viewport geometry', () => {
  assert.equal(isUsableCaretRect({
    left: 580,
    right: 580,
    top: 490,
    bottom: 550,
    width: 0,
    height: 60,
  }), true)
})

test('rejects all-zero and non-finite caret geometry', () => {
  assert.equal(isUsableCaretRect({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }), false)
  assert.equal(isUsableCaretRect({ left: Number.NaN, right: 0, top: 0, bottom: 20, width: 0, height: 20 }), false)
})

test('falls below when the menu cannot fit above', () => {
  assert.equal(placeMentionMenu(
    { left: 100, right: 100, top: 40, bottom: 60 },
    { width: 240, height: 180 },
    { width: 1200, height: 800 },
  ).placement, 'below')
})

test('clamps horizontally to viewport margins', () => {
  assert.equal(placeMentionMenu(
    { left: 1150, right: 1150, top: 400, bottom: 420 },
    { width: 240, height: 180 },
    { width: 1200, height: 800 },
  ).left, 952)
})
```

- [ ] **Step 2: Run the helper test and verify RED**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/mention-position.test.ts
```

Expected: FAIL because `isUsableCaretRect` does not exist and placement currently prefers below.

- [ ] **Step 3: Implement the minimal geometry validator and above-first placement**

```ts
type RectLike = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export function isUsableCaretRect(rect: RectLike): boolean {
  const values = [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height]
  return values.every(Number.isFinite)
    && rect.height > 0
    && !(rect.left === 0 && rect.right === 0 && rect.top === 0 && rect.bottom === 0)
}

export function placeMentionMenu(caret, menu, viewport, gap = 8) {
  const margin = 8
  const fitsAbove = caret.top - gap - menu.height >= margin
  const placement: 'above' | 'below' = fitsAbove ? 'above' : 'below'
  const rawTop = placement === 'above'
    ? caret.top - gap - menu.height
    : caret.bottom + gap

  return {
    left: Math.min(Math.max(caret.left, margin), viewport.width - menu.width - margin),
    top: Math.min(Math.max(rawTop, margin), viewport.height - menu.height - margin),
    placement,
  }
}
```

In `MentionTextarea.computePlacement()`, replace the width/height fallback condition:

```ts
const r = q.range.getBoundingClientRect()
caretRect = isUsableCaretRect(r) ? r : el.getBoundingClientRect()
```

Import `isUsableCaretRect` beside `placeMentionMenu`.

- [ ] **Step 4: Run mention and interaction tests**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test \
  lib/mention-position.test.ts \
  lib/mention-state.test.ts \
  lib/mention-identity.test.ts \
  lib/canvas-node-interactions.test.ts \
  lib/realtime/react-flow-binding.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit the caret popup fix**

```bash
rtk git add \
  nexoclip-app/services/spite/lib/mention-position.ts \
  nexoclip-app/services/spite/lib/mention-position.test.ts \
  nexoclip-app/services/spite/components/canvas/mention-textarea.tsx
rtk git commit -m "fix(canvas): place mention popup above caret"
```

---

### Task 2: Verify and Rebuild Docker

**Files:**
- Modify only files required by regressions directly caused by Task 1.

**Interfaces:**
- Produces: a verified local `main` and refreshed Docker Compose runtime.

- [ ] **Step 1: Run the complete Spite test suite**

```bash
cd nexoclip-app/services/spite
rtk npm test
```

Expected: zero failures; the DOM caret selection test may remain skipped when `jsdom` is unavailable.

- [ ] **Step 2: Run the Spite production build**

```bash
cd nexoclip-app/services/spite
rtk npm run build
```

Expected: build and TypeScript checks pass. Restore `next-env.d.ts` if Next rewrites its generated route-types import.

- [ ] **Step 3: Verify scope and request review**

```bash
rtk proxy git diff --check
rtk git status --short
```

Review the helper math, collapsed-caret validity, editor fallback, portal coordinates, and preservation of keyboard/click mention behavior.

- [ ] **Step 4: Rebuild Docker without deleting volumes**

```bash
rtk docker compose up -d --build
```

Do not run `docker compose down -v`.

- [ ] **Step 5: Verify runtime health**

```bash
rtk docker compose ps
rtk curl http://localhost/spite/healthz
```

Expected: persistent services remain running/healthy and health returns `{"ok":true}`.

- [ ] **Step 6: Manual acceptance**

1. Open a Prompt node and type `@` on a middle line.
2. Confirm the dropdown appears 8px above the caret instead of at the node's lower-left edge.
3. Move near the top viewport edge and type `@`.
4. Confirm the dropdown falls below the caret.
5. Confirm Arrow keys, Enter/Tab, Escape, and mouse selection still work.
