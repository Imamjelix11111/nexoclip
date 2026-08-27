# Hide Vibe Motion + Audio Studio (soft-hide, reversible)

Date: 2026-08-27
Related: `docs/2026-08-24-muapi-dependency-audit.md` (both studios listed under
"Pure MuAPI — no fallback exists"), `docs/superpowers/specs/2026-08-27-video-studio-openrouter-filter-design.md`

## Why

Per the MuAPI dependency audit, Vibe Motion Studio and Audio Studio both call
MuAPI directly with no OpenRouter/direct-provider fallback — if MuAPI goes
down or rate-limits, these two studios fail outright with no backup path.
Nothing has been built yet to give them a fallback (that's a separate,
larger effort — N vendor-specific integrations per the audit's open
questions). Until that's decided, the user wants both studios hidden from
the app so users don't hit a feature that could fail with no recourse.

This is explicitly a **soft-hide**: the studios' code, imports, and render
logic stay in place untouched. Only their visibility (nav + deep-link) is
turned off, via a `hidden` flag on their `TABS` entries — not by deleting
array entries. Re-enabling later is a one-line flip per studio.

## Where this lives

Single file: `nexoclip-app/components/StandaloneShell.js`. This is the only
place either studio is wired into the app (confirmed via repo-wide grep for
`vibe-motion`, `VibeMotionStudio`, `AudioStudio`, `'audio'` tab id — no
other nav/router/menu surface references them).

Relevant existing structure:
- `TABS` (array, ~line 33): each entry is `{ id, label, icon }`. Vibe Motion
  is `{ id: 'vibe-motion', ... }` (~line 79); Audio is `{ id: 'audio',
  label: 'Audio Studio', ... }` (~line 56).
- `NAVIGATION_CATEGORIES` (array, ~line 165): groups `tabIds` under a
  category label for sidebar rendering. Vibe Motion's id lives inside the
  "Video" category's `tabIds` (~line 178, alongside `video`, `clipping`,
  `lipsync`, `body-swap`, `marketing`). Audio has its **own** top-level
  category (~line 187: `{ id: 'audio', label: 'Audio', tabIds: ['audio'] }`)
  — this category will render as an empty, label-only group once its one
  tab is hidden unless the render logic skips empty categories.
- Three entry points set `activeTab` from an external source (not a direct
  nav click) and each currently accepts any id present in `TABS`,
  hidden or not:
  - `getInitialTab()` (~line 254) — first load, resolves from the URL slug.
  - The `popstate` handler (~line 390) — browser back/forward, resolves
    from `window.location.pathname`.
  - The nav sidebar render loop (~line 769-780) — builds each category's
    visible tab list via `category.tabIds.map(...).filter(Boolean)`.
- `handleTabChange(tabId)` (~line 403) is the generic setter used by nav
  clicks *and* by `handleOpenNotification` (clicking a notification about a
  past generation job). It does not validate against `TABS` at all.

## Design

**1. Mark, don't remove.** Add `hidden: true` to the two `TABS` entries,
with a one-line comment pointing at the audit doc:

```js
{
  id: 'vibe-motion',
  label: 'Vibe Motion',
  hidden: true, // pure-MuAPI, no fallback — see docs/2026-08-24-muapi-dependency-audit.md
  icon: (...)
},
```

and the same shape for the `audio` entry.

**2. Sidebar rendering skips hidden tabs, and skips empty categories.** At
the nav category render loop (~line 769), change the `.filter(Boolean)`
step to also drop hidden tabs, then skip rendering a category `<div>`
entirely if its resulting visible-tab list is empty (this is what makes the
now-empty "Audio" category disappear instead of showing an empty labeled
group in the sidebar).

**3. Deep-link and back/forward navigation fall back to default, not to
the hidden studio.** Both `getInitialTab()` and the `popstate` handler
change their `TABS.find(t => t.id === x)` check to also require `!hidden`.
A URL like `/studio/vibe-motion` or `/studio/audio` (freshly typed, an old
bookmark, or browser back button landing there) will no longer resolve —
`getInitialTab()` falls through to its existing default (`'image'`), and
the `popstate` handler simply won't call `setActiveTab` for that id (also
leaving whatever tab was already active, which in practice means the same
fallback path applies since the app already redirected away on load).

**4. Deliberately untouched — scope decision, not an oversight:**
- `VibeMotionStudio`/`AudioStudio` imports and their conditional render
  blocks (`{activeTab === 'vibe-motion' && (...)}` etc.) stay exactly as
  they are. `activeTab` can no longer *become* one of these ids through any
  of the three guarded entry points, so these blocks simply become
  unreachable — no need to touch them, and this is what keeps re-enabling
  a one-line flip later.
- `handleTabChange` itself stays unguarded. It's a generic setter used by
  legitimate nav clicks (which can no longer target a hidden tab, since the
  sidebar won't render a button for it) *and* by
  `handleOpenNotification` — clicking a notification for a job that was
  generated on Vibe Motion/Audio Studio *before* this change will still
  open that studio to show the result, the same "old history still
  renders" precedent set by the Video Studio V2V filter work. This is an
  intentional choice: hiding the entry points for *starting new* work on
  these studios, not blocking access to *past* results.

## Testing

No automated test harness for this component (same situation as
`VideoStudio.jsx` in the prior plan — no RTL/jsdom in this app). Manual
verification, in the running app:

1. Sidebar: "Vibe Motion" no longer appears under the "Video" category;
   the "Audio" category no longer appears at all.
2. Navigate to `/studio/vibe-motion` and `/studio/audio` directly (address
   bar) — both fall back to the Image Studio (or whatever the app's default
   tab is), not the hidden studio.
3. From Image Studio, click into another tab, then use the browser back
   button repeatedly through history that would include a hidden tab's
   URL (if any exists in this session's navigation) — confirm it's skipped,
   not shown blank or broken.
4. (If feasible) Trigger or locate a notification for a pre-existing
   Vibe Motion or Audio Studio job and confirm clicking it still opens that
   studio with the result visible — this confirms the "past results still
   reachable" scope decision behaves as designed, not as an accidental gap.

## Out of scope

- Building an OpenRouter/direct-provider fallback for either studio (the
  audit's actual open question — this soft-hide is a stopgap, not a fix).
- Hiding/blocking `handleOpenNotification`'s click-through to past results.
- Any change to the other 5 pure-MuAPI studios flagged in the audit (Lip
  Sync, Recast, Marketing, Video Studio V2V, Workflow) — not requested.
