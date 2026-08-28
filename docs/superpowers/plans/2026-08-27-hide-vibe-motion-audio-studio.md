# Hide Vibe Motion + Audio Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Soft-hide Vibe Motion Studio and Audio Studio from the app's nav sidebar and from deep-link/browser-navigation URLs, without deleting their code or `TABS` entries, so re-enabling later is a one-line flip.

**Architecture:** Add a `hidden: true` flag to the two studios' entries in the `TABS` array in `nexoclip-app/components/StandaloneShell.js`. Every place that resolves a tab id from an external source (initial URL load, browser back/forward, and the sidebar's category render loop) is updated to skip entries where `hidden` is true. The studios' imports, render blocks, and the generic `handleTabChange`/notification-click path are left untouched — a job history notification for a hidden studio can still open it to show a past result.

**Tech Stack:** Next.js App Router, React (client component), JavaScript ESM. No automated test harness exists for this component (no RTL/jsdom in this app) — verification is manual, in the running dev server.

## Global Constraints

- Do not remove the `vibe-motion` or `audio` entries from `TABS` — add a `hidden` flag instead. Reversibility is a hard requirement (spec: "Mark, don't remove").
- Do not touch `VibeMotionStudio`/`AudioStudio` imports or their conditional render blocks (`{activeTab === 'vibe-motion' && (...)}` etc.) — they become unreachable through the guarded entry points, no code change needed there.
- Do not guard `handleTabChange` or `handleOpenNotification` — clicking a notification for a pre-existing job on either hidden studio must still open it (explicit scope decision in the spec, not an oversight).
- The "Audio" nav category must not render as an empty labeled group once its only tab (`audio`) is hidden — the category itself must be skipped when it has zero visible tabs.
- Jangan mengubah perubahan user yang sudah ada: `Seedance2.0 Model Card.pdf` dan file/direktori untracked lain di working tree.

---

### Task 1: Soft-hide Vibe Motion and Audio Studio

**Files:**
- Modify: `nexoclip-app/components/StandaloneShell.js`

**Interfaces:** None — this is a single self-contained UI-visibility change with no exports consumed by or produced for other tasks.

This component has no automated test harness (no React Testing Library/jsdom in this package — same situation as `VideoStudio.jsx` in the prior OpenRouter-filter plan). Verification is manual, via the dev server, covered in Steps 6-10 below.

- [ ] **Step 1: Add `hidden: true` to the `audio` TABS entry**

Find, in the `TABS` array (`nexoclip-app/components/StandaloneShell.js`):

```js
  {
    id: 'audio',
    label: 'Audio Studio',
    icon: (
```

Change to:

```js
  {
    id: 'audio',
    label: 'Audio Studio',
    hidden: true, // pure-MuAPI, no fallback — see docs/2026-08-24-muapi-dependency-audit.md
    icon: (
```

- [ ] **Step 2: Add `hidden: true` to the `vibe-motion` TABS entry**

Find:

```js
  {
    id: 'vibe-motion',
    label: 'Vibe Motion',
    icon: (
```

Change to:

```js
  {
    id: 'vibe-motion',
    label: 'Vibe Motion',
    hidden: true, // pure-MuAPI, no fallback — see docs/2026-08-24-muapi-dependency-audit.md
    icon: (
```

- [ ] **Step 3: Gate initial-load tab resolution**

Find, inside `getInitialTab()`:

```js
    if (firstSegment && TABS.find(t => t.id === firstSegment)) return firstSegment;
```

Change to:

```js
    if (firstSegment && TABS.find(t => t.id === firstSegment && !t.hidden)) return firstSegment;
```

- [ ] **Step 4: Gate browser back/forward tab resolution**

Find, inside the `popstate` handler:

```js
      if (TABS.find(t => t.id === tabId)) {
        setActiveTab(tabId);
      }
```

Change to:

```js
      if (TABS.find(t => t.id === tabId && !t.hidden)) {
        setActiveTab(tabId);
      }
```

- [ ] **Step 5: Skip hidden tabs in the sidebar, and skip categories left empty**

Find, in the nav category render loop:

```jsx
                    {NAVIGATION_CATEGORIES.map((category) => (
                      <div key={category.id} className={isCollapsed ? 'mb-1' : 'mb-4'}>
                        {!isCollapsed && (
                          <p className="px-2.5 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">
                            {category.label}
                          </p>
                        )}
                        <div className="space-y-0.5">
                          {category.tabIds
                            .map((tabId) => TABS.find((item) => item.id === tabId))
                            .filter(Boolean)
                            .map((tab) => renderStudioItem(tab))}
                        </div>
                      </div>
                    ))}
```

Change to:

```jsx
                    {NAVIGATION_CATEGORIES.map((category) => {
                      const visibleTabs = category.tabIds
                        .map((tabId) => TABS.find((item) => item.id === tabId))
                        .filter((tab) => tab && !tab.hidden);
                      if (visibleTabs.length === 0) return null;
                      return (
                        <div key={category.id} className={isCollapsed ? 'mb-1' : 'mb-4'}>
                          {!isCollapsed && (
                            <p className="px-2.5 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35">
                              {category.label}
                            </p>
                          )}
                          <div className="space-y-0.5">
                            {visibleTabs.map((tab) => renderStudioItem(tab))}
                          </div>
                        </div>
                      );
                    })}
```

Note the `.map((category) => (` implicit-return arrow became `.map((category) => {` with an explicit `return` — this is a required change in shape, not an incidental one, to allow the early `return null`.

- [ ] **Step 6: Grep-verify no other `TABS.find` call site was missed**

Run: `cd nexoclip-app && grep -n "TABS.find\|TABS\.map\|hidden:" components/StandaloneShell.js`

Expected: the two `hidden: true` lines from Steps 1-2, and every `TABS.find(...)` call in the file either includes `&& !t.hidden` / `&& !tab.hidden` (Steps 3-4-5) or is one of the following pre-existing call sites that this task intentionally does NOT change (all resolve an id that is either always visible or is a special-cased id like `'workflows'`, not user-navigable to a hidden tab): the `TABS.find(t => t.id === tabId)` calls inside `handleTabChange`-adjacent lookup helpers used only for label/count display of the *already-active* tab, and the `TABS.find((item) => item.id === 'workflows')` literal lookup. If you find a `TABS.find` call resolving an externally-supplied id (URL, notification payload, popstate) that this task's Steps 3-5 didn't cover, STOP and report BLOCKED — the plan's file-exploration may be incomplete for this file.

- [ ] **Step 7: Commit**

```bash
cd nexoclip-app
git add components/StandaloneShell.js
git commit -m "feat: soft-hide Vibe Motion and Audio Studio from nav and deep-links"
```

- [ ] **Step 8: Manual verification — dev server**

Run: `cd nexoclip-app && npm run dev`
Wait for `Ready` in the terminal, then open the app in a browser at the printed local URL, sign in if needed to reach the studio shell.

- [ ] **Step 9: Manual verification — sidebar**

In the browser: look at the left nav sidebar.
Expected: no "Vibe Motion" item under the "Video" category (the category itself still shows its other items — Video, AI Clipping, Lip Sync, Body Swap, Marketing). No "Audio" category header appears anywhere in the sidebar at all.

- [ ] **Step 10: Manual verification — deep-link fallback**

Navigate the browser directly to `/studio/vibe-motion`, then separately to `/studio/audio` (edit the address bar, not by clicking nav).
Expected: both land on the app's default tab (Image Studio), not on Vibe Motion or Audio Studio.

- [ ] **Step 11: Manual verification — browser back/forward**

From Image Studio, click into 2-3 other visible tabs (e.g. Video, then AI Clipping) to build browser history, then use the browser's back button repeatedly back to the start, then forward again.
Expected: navigation moves smoothly between the visible tabs actually visited; at no point does it land on Vibe Motion or Audio Studio (there should be no way to have visited them via clicks after this change, so this step is mainly confirming no crash/blank screen occurs during normal back/forward use).

- [ ] **Step 12: Manual verification — notification click-through to past results (if feasible)**

If a workspace has an existing notification for a completed Vibe Motion or Audio Studio generation job (from before this change), click it.
Expected: it still opens that studio showing the result — confirming the deliberate "past results stay reachable" scope decision works as designed. If no such notification exists in the available test workspace, skip this step with a note rather than fabricating one.

- [ ] **Step 13: Stop the dev server**

Stop the process started in Step 8 (Ctrl+C in that terminal, or `kill` the process if run in background).
