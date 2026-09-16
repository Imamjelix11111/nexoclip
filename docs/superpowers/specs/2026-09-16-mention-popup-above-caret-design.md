# Mention Popup Above Caret Design

## Goal

Position the Canvas mention suggestion popup directly above the active `@query` caret instead of falling back to the Prompt node bounds.

## Root Cause

A collapsed browser caret commonly reports a bounding rectangle with `width: 0` and a valid height and screen position. The current placement code treats either zero width or zero height as invalid:

```ts
if (r.width === 0 || r.height === 0) caretRect = el.getBoundingClientRect()
```

This replaces the valid caret position with the entire Prompt editor rectangle. Placement then uses the bottom of the large Prompt node, causing the menu to appear near the lower-left corner.

## Behavior

- Render the existing compact mention dropdown 8px above the active `@query` caret.
- Keep an approximately 240px popup width and a maximum 240px height with scrolling.
- Align the popup's left edge with the caret and clamp it to an 8px viewport margin.
- Prefer above-caret placement.
- Fall back below the caret only when the menu cannot fit above the 8px viewport margin.
- Treat a zero-width collapsed caret rectangle as valid when it has a finite position and positive height.
- Fall back to the editor rectangle only when caret geometry is unavailable or unusable, such as an all-zero/non-finite rectangle.
- Continue recalculating on query changes, nested scrolling, and viewport resizing.

## Preserved Interaction

- Arrow Up/Down changes the highlighted suggestion.
- Enter or Tab chooses the highlighted suggestion.
- Escape closes the popup.
- Clicking a suggestion inserts the mention chip.
- The editor retains focus and existing mention metadata/caret synchronization behavior.
- The popup remains portaled to `document.body` and uses fixed viewport coordinates.

## Implementation

- Extend `placeMentionMenu(...)` with an explicit preferred placement parameter or make its default preference `above` for this mention popup.
- Add a caret-geometry validity helper so zero-width collapsed ranges are accepted.
- Keep viewport clamping in the pure placement helper.
- Update `MentionTextarea` to use the valid collapsed range before considering the editor fallback.
- Do not introduce a modal, dependency, or global Canvas styling change.

## Testing

Pure helper tests will verify:

1. a menu with sufficient top space is placed 8px above the caret;
2. a zero-width caret with positive height is considered usable;
3. insufficient top space flips the menu below the caret;
4. horizontal coordinates remain clamped to an 8px viewport margin;
5. all-zero or non-finite geometry uses the editor fallback path.

Run the full Spite test suite and production build. After verification, rebuild Docker with `docker compose up -d --build` without removing persistent volumes.

## Acceptance

When the user types `@` on any line of a Prompt node, the suggestion dropdown appears immediately above that caret, including inside large or resized Prompt nodes. It does not appear at the Prompt node's lower-left edge.
