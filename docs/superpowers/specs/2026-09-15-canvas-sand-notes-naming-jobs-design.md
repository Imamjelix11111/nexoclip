# Canvas Sand Controls, Durable Naming, Notes, and Job Tracing

**Date:** 2026-09-15  
**Status:** Approved

## Objective

Improve the Canvas editing experience with a full-sand control theme, deterministic media-node names, caret-anchored mention suggestions, collaborative resizable Notes, and visible durable generation IDs. Mention chips must also remain chips across realtime guests and refreshes so generation references are not silently lost.

## Scope

### Included

- Full Sand styling for the left toolbar, compact/expanded Assets panels, and right Jobs panel.
- Automatic node naming from uploaded filenames and Character/Prop/Location folder names.
- Caret-anchored mention suggestions with viewport collision handling.
- Realtime mention metadata synchronization when serialized prompt text is unchanged.
- A dedicated Notes tool and resizable text-note node.
- Short durable generation IDs in every Jobs row with copy-full-ID behavior.

### Excluded

- Sand styling for the top toolbar, bottom bar, or controls inside generation nodes.
- A global theme system or user-selectable themes.
- New database tables or durable generation-history APIs.
- Connector handles or generation behavior for Notes.
- Changing provider safety policies, including BytePlus real-person restrictions.

## Visual Design

The selected direction is **Full Sand** for control panels while the Canvas and media nodes remain dark.

```text
Background:     #D7BD83
Surface/button: #C7AA70
Selected/hover: #FFF2C8
Border:         #EEDAA8
Primary text:   #493718
Secondary text: #6B542A
```

Semantic states retain their existing meaning: failures remain red, success remains green, and active generation indicators remain clearly distinguishable. Controls must preserve keyboard focus indicators and readable contrast.

The palette applies to:

1. Left compact toolbar.
2. Compact Assets panel and expanded Assets view.
3. Right Jobs panel.

## Automatic Node Naming

### Uploads

When a user uploads a PNG or other media file and a node is created from it, the node label uses the exact filename including extension.

```text
nathan-front.png -> nathan-front.png
```

### Character, Prop, and Location folders

After a generated Image node is successfully added to a Character, Prop, or Location folder, its label becomes the folder name.

```text
Character folder Nathan        -> Nathan
Prop folder DutyUniform        -> DutyUniform
Location folder Jakarta Studio -> Jakarta Studio
```

Folder naming always overwrites the current node label, including a manually edited label. The user may rename the node again afterward. The folder action must update the label only after the server confirms the folder operation; a failed action leaves the existing label unchanged.

Assets or whole folders dragged from the sidebar use the folder name where folder context exists. Standalone uploaded assets use their exact filename.

## Mention Synchronization and Suggestion Placement

### Realtime metadata

A mention consists of both serialized text and reference metadata:

```text
text:     "Use @Nathan"
mentions: [{ folderId, name, selectedAssetIds }]
```

The existing editor can receive unchanged text with changed mention metadata. Comparing text alone leaves a remote guest with a plain `@Nathan` token, which may later overwrite the authoritative metadata with an empty mention list.

The editor will compare a stable signature of both text and mention metadata. If a remote guest selects a mention while another guest has the same visible text, the second editor re-renders the token as a chip and retains its folder and selected asset IDs. If an editing guest has divergent local text, remote state must not clobber the in-progress text.

### Caret anchoring

The mention menu is rendered in a portal with fixed viewport coordinates derived from the current selection range. It appears directly below the active `@query` caret. The position is recalculated while typing and when the selection changes.

Collision rules:

- Flip above the caret when there is insufficient room below.
- Clamp horizontally inside the viewport.
- Preserve keyboard navigation and selection.
- Fall back to the editor edge only when the browser cannot provide a usable caret rectangle.

## Notes Tool and Node

A new **Notes** button is added next to the existing Sticker and Comment controls. It does not replace either existing tool.

The placement flow follows the existing Sticker tool:

1. User selects Notes.
2. User clicks a Canvas position.
3. A Note node is created at that flow position.
4. Its text editor receives focus.
5. The active tool returns to Select.

A Note node:

- Uses the sand note surface with dark readable text.
- Stores editable plain text in node data.
- Uses `ResizableNodeFrame` so width and height remain durable and collaborative.
- Can be selected, moved, duplicated, deleted, undone, and redone through existing Canvas commands.
- Has no input/output handles.
- Uses existing realtime Yjs persistence; no database migration is required.
- Provides an accessible text-editing label and visible keyboard focus.

## Jobs Panel Tracing

Each generation row derives its durable job ID in this order:

```text
active generationId -> lastGenerationId -> unavailable
```

When available, the row displays the first eight characters plus an ellipsis:

```text
84ca8451…
```

The shortened ID is a dedicated button rather than making the entire row copy the ID. Activating it:

1. Stops row focus navigation.
2. Copies the complete UUID to the clipboard.
3. Shows `Job ID copied` through Sonner.

The full UUID is available through the button's accessible label and title. Completed and failed rows retain `lastGenerationId`, so tracing survives terminal reconciliation and refresh.

This change remains node-backed and does not introduce historical rows for multiple generations from the same node.

## Component Changes

Expected implementation boundaries:

- `components/canvas/left-toolbar.tsx`: sand surfaces, Notes tool entry, asset/folder naming inputs.
- `components/canvas/jobs-panel.tsx`: sand panel and copyable durable ID.
- `components/canvas/mention-textarea.tsx`: state-signature comparison and caret rectangle anchoring.
- `components/canvas/nodes/prompt-node.tsx`: safe application of remote mention metadata during editing.
- `components/canvas/nodes/note-node.tsx`: new editable resizable annotation node.
- `components/canvas/canvas-workspace.tsx`: register Note node, placement tool, and deterministic initial labels.
- `components/canvas/add-to-folder-modal.tsx` and Image node integration: return/consume the successful folder name for label updates.
- `lib/mention-state.ts`: pure mention-state comparison helpers.

Existing Canvas collaboration commands remain the authoritative mutation path.

## Error Handling

- Failed uploads do not create or rename a node.
- Failed folder actions do not rename the source node.
- Clipboard failure shows an error toast and leaves navigation unaffected.
- Missing durable job IDs render no copy control.
- Invalid caret geometry uses an editor-relative fallback rather than hiding the menu.
- Notes respect Canvas read-only/degraded mutation guards.

## Testing

Automated coverage will include:

1. Same text plus changed mention metadata produces a distinct state signature.
2. An editing guest accepts remote chip metadata only when local text is unchanged.
3. Mention menu coordinates follow the caret and flip/clamp at viewport edges.
4. Uploaded asset labels preserve the complete filename.
5. Successful Add to Character/Prop/Location overwrites the node label with the folder name; failures do not.
6. Notes are registered, created through the toolbar, editable, resizable, and persisted through Canvas commands.
7. Jobs rows prefer active `generationId`, retain terminal `lastGenerationId`, shorten display, and copy the full UUID.
8. Sand styling remains scoped to the selected panels and preserves semantic status colors.
9. Existing Canvas interaction, realtime document, generation, Assets, and deployment tests remain green.

## Acceptance Criteria

- Two connected guests see the same mention chip metadata when one selects a mention without changing its serialized text.
- Mention chips remain intact after refresh and provide their selected assets to generation compilation.
- Mention suggestions appear at the typing caret, including wrapped lines and viewport edges.
- Sidebar, Assets, and Jobs use the approved Full Sand palette; unrelated controls remain dark.
- Uploaded media nodes use the exact source filename, including extension.
- Add to Character/Prop/Location changes the Image node label to that folder's name every time.
- Users can place, write, resize, move, duplicate, delete, undo, and redo Notes.
- Every current Canvas job with a durable ID exposes a short copyable ID in Jobs Panel.
