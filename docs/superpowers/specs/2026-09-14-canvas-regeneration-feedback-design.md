# Canvas Regeneration Feedback Design

## Goal

Make Image and Video Node regeneration unmistakable while preserving the previous successful media until a replacement succeeds.

## Scope

- Image Node and Video Node.
- First generation, regeneration, success, and failure visual states.
- Sonner success/failure notifications.
- Behavioral regression tests and local Docker verification.

No new backend state, schema, queue behavior, or generation history is introduced.

## State and Behavior

The durable generation status remains authoritative. The node distinguishes first generation from regeneration by whether it already has a usable output URL.

### First generation

When no previous output exists, the node keeps its current empty/loading presentation.

### Regeneration

When a previous output exists and the newest generation is `queued` or `processing`:

- Preserve and continue rendering the previous output URL.
- Dim the media with a dark overlay.
- Show an amber/orange border and subtle glow around the node.
- Show a centered spinner and `Generating new result…`.
- Show a `REGENERATING` badge in the node header.
- Prevent the generate action from submitting duplicate jobs while one is active.

The previous output is only a visual fallback. Jobs Panel and durable status continue to describe the newest generation.

### Success

When the newest generation completes:

- Replace the previous media with the new output atomically.
- Remove the overlay, badge, and active border.
- Dispatch the existing asset refresh event.
- Show one Sonner notification per generation ID:
  - `Image regenerated successfully`
  - `Video regenerated successfully`

First-generation completion uses equivalent `generated successfully` wording.

### Failure

When the newest generation fails and a previous output exists:

- Keep the previous media visible.
- Replace the active overlay with a red failure overlay.
- Show the provider/backend error when available.
- Provide a `Retry` action that submits a new durable generation.
- Show one Sonner error notification per generation ID.

When first generation fails without previous media, retain the existing empty-node failure state and add the same deduplicated notification.

## Notification Deduplication

Image and Video nodes already use Sonner. Each node records the last terminal generation ID for which it emitted a notification. Repeated polling, realtime reconciliation, rerenders, and React development behavior must not emit duplicate notifications for the same terminal generation.

Notifications are emitted only for terminal transitions observed while the node is mounted, not merely because an old completed/failed node was loaded after refresh.

## Accessibility

- Status text is readable without relying on border color.
- Active and failure overlays expose an appropriate live status.
- Spinner/overlay animation respects `prefers-reduced-motion`.
- Retry remains keyboard accessible.

## Testing

Add focused tests for both Image and Video nodes covering:

1. Existing media remains present during regeneration.
2. Regeneration state renders the amber border, overlay, badge, and status text.
3. Successful completion swaps the output and emits exactly one success notification.
4. Failure preserves prior output and emits exactly one error notification.
5. Repeated terminal reconciliation does not duplicate notifications.
6. First generation remains distinguishable from regeneration.

Run the focused Canvas tests, Spite production build, Docker rebuild/restart, route health check, and service log smoke test.
