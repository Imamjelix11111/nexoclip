# Canvas Dark Rollback and Comment Delete Fix

## Goal

Restore the previous dark Canvas control styling, remove the Notes feature, and fix Comment deletion without undoing the approved mention, naming, and durable Job ID improvements.

## Scope

### Restore dark controls

- Restore the left toolbar, compact Assets panel, expanded Assets panel, and Jobs panel to their pre-Full-Sand dark visual treatment.
- Remove all `--sand-*` variables and Sand-only styling/tests.
- Preserve Jobs Panel durable ID display, full UUID copy action, active/terminal generation behavior, semantic status colors, and accessible button structure.

### Remove Notes

- Remove the Notes toolbar action.
- Remove `note` from the Canvas active-tool and node-type registration paths.
- Remove Note placement and initial-data handling.
- Delete the Note node component and Note-specific tests.
- Existing realtime, Sticker, and Comment behavior remains unchanged except for the Comment delete fix below.

### Fix Comment deletion

The Comment hover X is an action button, not a form submission control. It will:

- declare `type="button"`;
- stop pointer-down propagation so React Flow cannot begin a node drag or selection gesture;
- stop click propagation;
- invoke the existing collaborative `deleteNodes([id])` command exactly once.

This prevents accidental navigation/submission and keeps deletion inside the authoritative realtime Canvas mutation path.

## Preserved Features

The rollback must retain:

- realtime mention metadata synchronization;
- caret-preserving remote mention updates;
- caret-anchored mention suggestions;
- exact uploaded filename labels;
- successful Character/Prop/Location folder-name overwrite behavior;
- durable shortened Job IDs and full-ID copying;
- generation status and regeneration feedback behavior.

## Implementation Strategy

Use targeted restoration rather than reverting the entire commit range:

1. Restore `left-toolbar.tsx` from the last pre-Notes/pre-Sand implementation, then retain unrelated current behavior if the historical file differs outside those features.
2. Restore only the visual structure of `jobs-panel.tsx` from its pre-Sand implementation while retaining current durable Job ID and button-safety changes.
3. Remove Note-specific code and files.
4. Apply the minimal Comment delete button fix.
5. Remove obsolete Sand and Note tests; add a focused Comment deletion boundary test.

This avoids reverting naming, mention, and Job tracing work that shares later commits with the unwanted visual changes.

## Testing and Acceptance

Automated verification:

- Comment delete test proves the button is non-submitting, blocks pointer/click propagation, and uses collaborative deletion.
- Existing mention, naming, generation, realtime, and Job tracing tests continue to pass.
- Full Spite test suite passes.
- Spite production build passes.
- Repository diff contains no residual Sand variables or Note registration.

Runtime acceptance after Docker rebuild:

1. Canvas controls and Assets/Jobs panels use the previous dark appearance.
2. Notes tool is absent and new Notes cannot be created.
3. Clicking a Comment X removes the Comment without navigating away or showing a page-load error.
4. Job IDs, mentions, and media naming still work.
5. Docker volumes, databases, Redis data, and assets remain intact.

## Deployment

After verification, rebuild the existing local Compose stack with `docker compose up -d --build`. Do not use `down -v` or otherwise remove persistent volumes.
