# Canvas Sand Controls, Naming, Notes, and Job Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a Full Sand Canvas control treatment, reliable collaborative mentions, deterministic media-node naming, resizable Notes, and copyable durable job IDs.

**Architecture:** Keep the existing React Flow/Yjs architecture and add small pure helpers for state comparison, caret placement, naming, and job-ID presentation. UI components continue mutating durable state only through `useCanvasCollaboration`; no schema migration or dependency is introduced.

**Tech Stack:** Next.js 16, React 19, TypeScript, React Flow, Yjs/Hocuspocus, Tailwind CSS, Sonner, Node test runner with `tsx`.

## Global Constraints

- Full Sand applies only to the left toolbar, compact/expanded Assets panels, and right Jobs panel.
- Use `#D7BD83` background, `#C7AA70` surface, `#FFF2C8` selected/hover, `#EEDAA8` border, `#493718` primary text, and `#6B542A` secondary text.
- Failure remains red, success remains green, and active generation status remains distinguishable.
- Upload labels preserve the exact filename including extension.
- Successful Add to Character/Prop/Location always overwrites the current Image node label with the folder name; failed actions never rename.
- Mention suggestions anchor to the typing caret and flip/clamp inside the viewport.
- Notes are plain-text, collaborative, movable, duplicable, deletable, undoable, redoable, and resizable; Notes have no handles.
- Jobs show the first eight generation-ID characters plus an ellipsis and copy the complete UUID.
- Do not add dependencies or database migrations.
- Do not include `skills-lock.json`, `.superpowers/brainstorm/`, personal deployment specs/plans, `json.json`, `skill-prompt.txt`, or `to_json.py` in implementation commits.

---

## File Structure

### Create

- `nexoclip-app/services/spite/lib/mention-state.ts` — stable text-plus-mention signatures and safe remote-sync decision.
- `nexoclip-app/services/spite/lib/mention-state.test.ts` — two-guest mention metadata regression coverage.
- `nexoclip-app/services/spite/lib/mention-position.ts` — pure caret-menu collision calculation.
- `nexoclip-app/services/spite/lib/mention-position.test.ts` — below/above/horizontal clamp coverage.
- `nexoclip-app/services/spite/lib/canvas-media-label.ts` — exact upload and folder-result label helpers.
- `nexoclip-app/services/spite/lib/canvas-media-label.test.ts` — filename and folder-name behavior.
- `nexoclip-app/services/spite/components/canvas/nodes/note-node.tsx` — editable resizable annotation node.
- `nexoclip-app/services/spite/lib/note-node.test.ts` — registration, placement, persistence, and accessibility assertions.
- `nexoclip-app/services/spite/lib/job-tracing.ts` — generation-ID selection and shortening.
- `nexoclip-app/services/spite/lib/job-tracing.test.ts` — active/terminal/absent ID coverage.
- `nexoclip-app/services/spite/lib/canvas-sand.test.ts` — scoped palette and semantic-status assertions.

### Modify

- `nexoclip-app/services/spite/components/canvas/mention-textarea.tsx` — metadata-aware prop synchronization and caret-anchored menu coordinates.
- `nexoclip-app/services/spite/components/canvas/nodes/prompt-node.tsx` — accept safe metadata-only remote updates while editing.
- `nexoclip-app/services/spite/components/canvas/add-to-folder-modal.tsx` — report the successfully selected/created folder.
- `nexoclip-app/services/spite/components/canvas/nodes/image-node.tsx` — rename from successful folder result.
- `nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx` — exact upload names and Note registration/placement.
- `nexoclip-app/services/spite/components/canvas/left-toolbar.tsx` — Notes button and Full Sand surfaces.
- `nexoclip-app/services/spite/components/canvas/jobs-panel.tsx` — Full Sand panel and copyable durable ID.

---

### Task 1: Preserve Mention Metadata Across Guests

**Files:**
- Create: `nexoclip-app/services/spite/lib/mention-state.ts`
- Create: `nexoclip-app/services/spite/lib/mention-state.test.ts`
- Modify: `nexoclip-app/services/spite/components/canvas/mention-textarea.tsx`
- Modify: `nexoclip-app/services/spite/components/canvas/nodes/prompt-node.tsx`

**Interfaces:**
- Produces: `mentionStateKey(text: string, mentions: PersistedMention[]): string`
- Produces: `shouldApplyRemoteMentionState(input): boolean`
- Consumes: existing `Mention` shape `{ folderId, name, selectedAssetIds }`.

- [ ] **Step 1: Write the failing metadata-only collaboration tests**

```ts
const noMentions = []
const nathan = [{ folderId: 'character-1', name: 'Nathan', selectedAssetIds: ['front', 'side'] }]

assert.notEqual(
  mentionStateKey('Use @Nathan', noMentions),
  mentionStateKey('Use @Nathan', nathan),
)
assert.equal(shouldApplyRemoteMentionState({
  editing: true,
  localText: 'Use @Nathan',
  localMentions: noMentions,
  incomingText: 'Use @Nathan',
  incomingMentions: nathan,
}), true)
assert.equal(shouldApplyRemoteMentionState({
  editing: true,
  localText: 'Use @Nat',
  localMentions: noMentions,
  incomingText: 'Use @Nathan',
  incomingMentions: nathan,
}), false)
```

- [ ] **Step 2: Run the regression test and confirm RED**

Run:

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/mention-state.test.ts
```

Expected: FAIL because `mention-state` or its exports do not exist.

- [ ] **Step 3: Implement the stable state signature and remote-sync decision**

```ts
export type PersistedMention = {
  folderId: string
  name: string
  selectedAssetIds: string[]
}

export function mentionStateKey(text: string, mentions: PersistedMention[]): string {
  return JSON.stringify([text, mentions.map((m) => [m.folderId, m.name, m.selectedAssetIds])])
}

export function shouldApplyRemoteMentionState(input: {
  editing: boolean
  localText: string
  localMentions: PersistedMention[]
  incomingText: string
  incomingMentions: PersistedMention[]
}): boolean {
  if (!input.editing) return true
  if (input.localText !== input.incomingText) return false
  return mentionStateKey(input.localText, input.localMentions)
    !== mentionStateKey(input.incomingText, input.incomingMentions)
}
```

In `MentionTextarea`, replace the text-only `lastSerialized` value with `mentionStateKey(text, mentions)`. In `PromptNode`, apply incoming mention metadata while editing only when `shouldApplyRemoteMentionState` returns true.

- [ ] **Step 4: Verify mention and realtime regressions are GREEN**

Run:

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test \
  lib/mention-state.test.ts \
  lib/mention-identity.test.ts \
  lib/canvas-node-interactions.test.ts \
  lib/realtime/document.test.ts \
  lib/realtime/react-flow-binding.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit the collaboration fix**

```bash
rtk git add \
  nexoclip-app/services/spite/lib/mention-state.ts \
  nexoclip-app/services/spite/lib/mention-state.test.ts \
  nexoclip-app/services/spite/components/canvas/mention-textarea.tsx \
  nexoclip-app/services/spite/components/canvas/nodes/prompt-node.tsx
rtk git commit -m "fix(canvas): preserve realtime mentions"
```

---

### Task 2: Anchor Mention Suggestions to the Caret

**Files:**
- Create: `nexoclip-app/services/spite/lib/mention-position.ts`
- Create: `nexoclip-app/services/spite/lib/mention-position.test.ts`
- Modify: `nexoclip-app/services/spite/components/canvas/mention-textarea.tsx`

**Interfaces:**
- Produces: `placeMentionMenu(caret, menu, viewport, gap?): { left: number; top: number; placement: 'above' | 'below' }`
- Consumes: `Range.getBoundingClientRect()` from the active `@query` selection.

- [ ] **Step 1: Write failing caret placement tests**

```ts
assert.deepEqual(
  placeMentionMenu(
    { left: 100, right: 101, top: 80, bottom: 100 },
    { width: 240, height: 180 },
    { width: 1200, height: 800 },
  ),
  { left: 100, top: 108, placement: 'below' },
)

assert.equal(placeMentionMenu(
  { left: 100, right: 101, top: 700, bottom: 720 },
  { width: 240, height: 180 },
  { width: 1200, height: 800 },
).placement, 'above')

assert.equal(placeMentionMenu(
  { left: 1150, right: 1151, top: 80, bottom: 100 },
  { width: 240, height: 180 },
  { width: 1200, height: 800 },
).left, 952)
```

Use an 8px gap and 8px viewport margin.

- [ ] **Step 2: Run the placement test and confirm RED**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/mention-position.test.ts
```

Expected: FAIL because `placeMentionMenu` does not exist.

- [ ] **Step 3: Implement collision-aware menu positioning**

```ts
export function placeMentionMenu(caret, menu, viewport, gap = 8) {
  const margin = 8
  const fitsBelow = caret.bottom + gap + menu.height <= viewport.height - margin
  const placement = fitsBelow ? 'below' : 'above'
  const rawTop = placement === 'below'
    ? caret.bottom + gap
    : caret.top - gap - menu.height
  return {
    left: Math.min(Math.max(caret.left, margin), viewport.width - menu.width - margin),
    top: Math.min(Math.max(rawTop, margin), viewport.height - menu.height - margin),
    placement,
  }
}
```

In `MentionTextarea`:

- Store menu coordinates in state.
- Measure the active query range after input/selection changes.
- Measure the portal menu after render and call `placeMentionMenu`.
- Render with `position: fixed`, `left`, and `top` instead of anchoring to the node's left edge.
- Recalculate on scroll/resize while open.
- Use the editor rectangle as fallback when the range rectangle is empty.

- [ ] **Step 4: Run placement and mention tests**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/mention-position.test.ts lib/mention-state.test.ts lib/mention-identity.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit caret anchoring**

```bash
rtk git add \
  nexoclip-app/services/spite/lib/mention-position.ts \
  nexoclip-app/services/spite/lib/mention-position.test.ts \
  nexoclip-app/services/spite/components/canvas/mention-textarea.tsx
rtk git commit -m "fix(canvas): anchor mentions to caret"
```

---

### Task 3: Apply Deterministic Media Node Names

**Files:**
- Create: `nexoclip-app/services/spite/lib/canvas-media-label.ts`
- Create: `nexoclip-app/services/spite/lib/canvas-media-label.test.ts`
- Modify: `nexoclip-app/services/spite/components/canvas/add-to-folder-modal.tsx`
- Modify: `nexoclip-app/services/spite/components/canvas/nodes/image-node.tsx`
- Modify: `nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx`

**Interfaces:**
- Produces: `uploadedMediaLabel(filename: string): string`
- Produces: `folderMediaLabel(folderName: string): string`
- Extends: `AddToFolderModalProps.onAdded?: (folder: { id: string; name: string; type: FolderType }) => void`

- [ ] **Step 1: Write failing naming tests**

```ts
assert.equal(uploadedMediaLabel('nathan-front.png'), 'nathan-front.png')
assert.equal(uploadedMediaLabel('scene.final.v2.PNG'), 'scene.final.v2.PNG')
assert.equal(folderMediaLabel('  Nathan  '), 'Nathan')
```

Add source assertions that `pasteImageFile` uses `uploadedMediaLabel(file.name)` and that `ImageNode` handles `onAdded` by persisting `folder.name`.

- [ ] **Step 2: Run naming tests and confirm RED**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/canvas-media-label.test.ts
```

Expected: FAIL because the helper does not exist and upload currently strips the extension.

- [ ] **Step 3: Implement naming and success callbacks**

```ts
export function uploadedMediaLabel(filename: string): string {
  return filename.trim() || 'Upload'
}

export function folderMediaLabel(folderName: string): string {
  return folderName.trim()
}
```

Change `pasteImageFile` from `file.name.replace(/\.[^.]+$/, '')` to `uploadedMediaLabel(file.name)` and send the same exact filename to asset registration.

Add this modal callback:

```ts
type AddedFolder = { id: string; name: string; type: FolderType }
onAdded?: (folder: AddedFolder) => void
```

For an existing folder, call `onAdded(folder)` only after its PATCH succeeds. For a new folder, parse the successful response and call `onAdded({ id, name: newName.trim(), type: folderType })`. In `ImageNode`:

```tsx
onAdded={(folder) => {
  syncGuardRef.current.beginUserEdit()
  patchPersistedNodeData({ label: folderMediaLabel(folder.name) })
}}
```

Do not call the callback in any catch/failure branch.

- [ ] **Step 4: Run naming and folder regression tests**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test \
  lib/canvas-media-label.test.ts \
  lib/add-generated-image-to-folder.test.ts \
  lib/generation-node-prop-sync.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit deterministic naming**

```bash
rtk git add \
  nexoclip-app/services/spite/lib/canvas-media-label.ts \
  nexoclip-app/services/spite/lib/canvas-media-label.test.ts \
  nexoclip-app/services/spite/components/canvas/add-to-folder-modal.tsx \
  nexoclip-app/services/spite/components/canvas/nodes/image-node.tsx \
  nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx
rtk git commit -m "feat(canvas): name nodes from assets"
```

---

### Task 4: Add Collaborative Resizable Notes

**Files:**
- Create: `nexoclip-app/services/spite/components/canvas/nodes/note-node.tsx`
- Create: `nexoclip-app/services/spite/lib/note-node.test.ts`
- Modify: `nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx`
- Modify: `nexoclip-app/services/spite/components/canvas/left-toolbar.tsx`

**Interfaces:**
- Adds node type: `note`
- Extends active tool union: `'select' | 'cut' | 'sticker' | 'comment' | 'note'`
- Stores durable node data: `{ text: string, label: 'Note', sceneId: string, width?: number, height?: number }`

- [ ] **Step 1: Write failing Note registration and interaction assertions**

The test reads the component sources and verifies these behavior boundaries:

```ts
assert.match(workspaceSource, /note:\s*NoteNode/)
assert.match(workspaceSource, /activeTool === 'note'/)
assert.match(toolbarSource, /id: 'note'/)
assert.match(noteSource, /ResizableNodeFrame/)
assert.match(noteSource, /patchNodeData\(id, \{ text:/)
assert.match(noteSource, /aria-label="Note text"/)
assert.doesNotMatch(noteSource, /<Handle/)
```

- [ ] **Step 2: Run the Note test and confirm RED**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/note-node.test.ts
```

Expected: FAIL because Note node/tool do not exist.

- [ ] **Step 3: Implement `NoteNode`**

Use `ResizableNodeFrame` with:

```tsx
defaultSize={{ width: 240, height: 160 }}
bounds={{ minWidth: 160, minHeight: 100, maxWidth: 900, maxHeight: 900 }}
```

Render a full-size sand textarea:

```tsx
<textarea
  ref={inputRef}
  aria-label="Note text"
  value={text}
  onChange={(event) => {
    const next = event.target.value
    setText(next)
    patchNodeData(id, { text: next })
  }}
  className="nodrag nopan h-full w-full resize-none bg-transparent outline-none"
/>
```

Synchronize `data.text` when the local textarea is not focused. Add a hover delete button matching Sticker/Comment behavior. Do not render React Flow handles.

Register `note: NoteNode`, add the toolbar item with a Notes icon, include `note` in `makeNode`, placement, cursor, and active-tool unions, and return to Select after placement.

- [ ] **Step 4: Run Note and realtime tests**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/note-node.test.ts lib/realtime/react-flow-binding.test.ts lib/canvas-node-interactions.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit Notes**

```bash
rtk git add \
  nexoclip-app/services/spite/components/canvas/nodes/note-node.tsx \
  nexoclip-app/services/spite/components/canvas/canvas-workspace.tsx \
  nexoclip-app/services/spite/components/canvas/left-toolbar.tsx \
  nexoclip-app/services/spite/lib/note-node.test.ts
rtk git commit -m "feat(canvas): add resizable notes"
```

---

### Task 5: Show Copyable Durable Job IDs

**Files:**
- Create: `nexoclip-app/services/spite/lib/job-tracing.ts`
- Create: `nexoclip-app/services/spite/lib/job-tracing.test.ts`
- Modify: `nexoclip-app/services/spite/components/canvas/jobs-panel.tsx`

**Interfaces:**
- Produces: `resolveDurableJobId(data: Record<string, unknown>): string | null`
- Produces: `shortJobId(id: string): string`

- [ ] **Step 1: Write failing job-ID tests**

```ts
assert.equal(resolveDurableJobId({ generationId: 'active-id', lastGenerationId: 'old-id' }), 'active-id')
assert.equal(resolveDurableJobId({ lastGenerationId: 'terminal-id' }), 'terminal-id')
assert.equal(resolveDurableJobId({}), null)
assert.equal(shortJobId('84ca8451-894e-43d7-8e2f-0fee6abfd292'), '84ca8451…')
```

- [ ] **Step 2: Run job tracing test and confirm RED**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/job-tracing.test.ts
```

Expected: FAIL because `job-tracing` does not exist.

- [ ] **Step 3: Implement helpers and accessible copy control**

```ts
export function resolveDurableJobId(data: Record<string, unknown>): string | null {
  const value = data.generationId || data.lastGenerationId
  return typeof value === 'string' && value ? value : null
}

export function shortJobId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}
```

Add `generationId` to the `Job` view model. Refactor `JobRow` so it does not nest a button inside the existing row button: use a row `<div>`, a main focus button, and a sibling ID-copy button.

```tsx
<button
  type="button"
  title={job.generationId}
  aria-label={`Copy full job ID ${job.generationId}`}
  onClick={async () => {
    try {
      await navigator.clipboard.writeText(job.generationId!)
      toast.success('Job ID copied')
    } catch {
      toast.error("Couldn't copy Job ID")
    }
  }}
>
  {shortJobId(job.generationId)}
</button>
```

- [ ] **Step 4: Run job and generation reconciliation tests**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test \
  lib/job-tracing.test.ts \
  lib/generation-node.test.ts \
  lib/generation-feedback.test.ts \
  lib/durable-generation.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit job tracing**

```bash
rtk git add \
  nexoclip-app/services/spite/lib/job-tracing.ts \
  nexoclip-app/services/spite/lib/job-tracing.test.ts \
  nexoclip-app/services/spite/components/canvas/jobs-panel.tsx
rtk git commit -m "feat(canvas): expose durable job ids"
```

---

### Task 6: Apply Scoped Full Sand Controls

**Files:**
- Create: `nexoclip-app/services/spite/lib/canvas-sand.test.ts`
- Modify: `nexoclip-app/services/spite/components/canvas/left-toolbar.tsx`
- Modify: `nexoclip-app/services/spite/components/canvas/jobs-panel.tsx`

**Interfaces:**
- Produces scoped CSS custom properties on panel roots:
  - `--sand-bg: #D7BD83`
  - `--sand-surface: #C7AA70`
  - `--sand-active: #FFF2C8`
  - `--sand-border: #EEDAA8`
  - `--sand-text: #493718`
  - `--sand-muted: #6B542A`

- [ ] **Step 1: Write failing scoped palette tests**

Assert that `left-toolbar.tsx` and `jobs-panel.tsx` contain all six approved values, while `canvas-toolbar.tsx`, `bottom-bar.tsx`, `image-node.tsx`, and `video-node.tsx` do not receive the `--sand-bg` panel token. Assert Jobs still contains `text-red-` and `text-green-` semantic classes.

- [ ] **Step 2: Run palette test and confirm RED**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/canvas-sand.test.ts
```

Expected: FAIL because panel roots still use dark glass surfaces.

- [ ] **Step 3: Apply the Full Sand palette to selected panel roots**

Use scoped inline CSS variables at the left-toolbar and Jobs roots, then replace dark panel surfaces with variable-backed classes/styles:

```tsx
style={{
  '--sand-bg': '#D7BD83',
  '--sand-surface': '#C7AA70',
  '--sand-active': '#FFF2C8',
  '--sand-border': '#EEDAA8',
  '--sand-text': '#493718',
  '--sand-muted': '#6B542A',
  background: 'var(--sand-bg)',
  color: 'var(--sand-text)',
} as React.CSSProperties}
```

Apply `var(--sand-surface)` to buttons/cards and `var(--sand-active)` to hover/selected states. Keep media thumbnails dark. Preserve explicit red/green status classes and visible keyboard focus rings.

- [ ] **Step 4: Run palette, Jobs, and Assets tests**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test lib/canvas-sand.test.ts lib/job-tracing.test.ts lib/add-generated-image-to-folder.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit the visual treatment**

```bash
rtk git add \
  nexoclip-app/services/spite/components/canvas/left-toolbar.tsx \
  nexoclip-app/services/spite/components/canvas/jobs-panel.tsx \
  nexoclip-app/services/spite/lib/canvas-sand.test.ts
rtk git commit -m "style(canvas): apply full sand panels"
```

---

### Task 7: Integration Verification

**Files:**
- Modify only files required by failures directly caused by Tasks 1–6.

**Interfaces:**
- Consumes all prior task outputs.
- Produces a production-buildable Spite Canvas release.

- [ ] **Step 1: Run focused Canvas tests**

```bash
cd nexoclip-app/services/spite
rtk npx tsx --test \
  lib/mention-state.test.ts \
  lib/mention-position.test.ts \
  lib/mention-identity.test.ts \
  lib/canvas-media-label.test.ts \
  lib/note-node.test.ts \
  lib/job-tracing.test.ts \
  lib/canvas-sand.test.ts \
  lib/canvas-node-interactions.test.ts \
  lib/generation-node.test.ts \
  lib/generation-feedback.test.ts \
  lib/durable-generation.test.ts \
  lib/realtime/document.test.ts \
  lib/realtime/react-flow-binding.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run the Spite production build**

```bash
cd nexoclip-app/services/spite
rtk npm run build
```

Expected: compile and TypeScript checks succeed. Restore `next-env.d.ts` if Next rewrites its generated route-types import.

- [ ] **Step 3: Verify formatting and repository scope**

```bash
rtk proxy git diff --check
rtk git status --short
```

Expected: no whitespace errors; only approved implementation files and explicitly excluded personal/unrelated files remain outside commits.

- [ ] **Step 4: Perform manual two-guest acceptance**

Use two authenticated browser sessions on the same project:

1. Guest 1 types `Use @Nathan` and selects the Character chip.
2. Confirm Guest 2 receives a chip without refreshing.
3. Refresh both and confirm the chip remains.
4. Type `@` after wrapped text and confirm the menu follows the caret.
5. Upload `nathan-front.png` and confirm the node label includes `.png`.
6. Add that Image output to Character `Nathan` and confirm the label becomes `Nathan`.
7. Place a Note, type text, resize it, and confirm Guest 2 sees content and dimensions.
8. Submit a generation, open Jobs, and copy the full UUID from the shortened ID.

Expected: all eight behaviors match the approved design.

- [ ] **Step 5: Request final code review**

Review the complete Task 1–6 diff for correctness, accessibility, realtime races, invalid nested interactive elements, and unintended sand-theme scope. Resolve Critical and Important findings, rerun Steps 1–3, and do not commit review-only artifacts.
