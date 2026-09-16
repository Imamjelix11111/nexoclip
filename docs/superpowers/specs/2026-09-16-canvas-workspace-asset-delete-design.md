# Canvas Workspace Asset Deletion Design

## Goal

Allow authenticated users to permanently delete workspace assets from the Canvas Assets panel without crossing workspace boundaries or breaking media currently used on the active Canvas.

## Design

Canvas continues sending deletion through Spite because Spite owns the authoritative realtime Canvas document. The request includes `projectId`. Spite verifies project ownership and blocks deletion with HTTP 403 when the asset ID is present in the authoritative Canvas projection. Legacy `generation_history` assets retain their existing deletion path.

For workspace assets, Spite forwards the authenticated request server-side to the main NexoClip asset endpoint. The main endpoint resolves and verifies the user's workspace, finds the asset by both workspace and asset ID, deletes its object, then deletes its PostgreSQL metadata. Spite removes matching folder links after successful deletion and the UI revalidates the Assets list.

## Error Handling

- Unauthenticated requests return 401.
- Assets outside the user's workspace return 404.
- Assets referenced by the active Canvas return 403 and remain intact.
- Object-storage failure returns an error and retains database metadata.
- UI reports protected, failed, and successful deletion outcomes using existing Sonner notifications.

## Testing

Add behavior tests for workspace-scoped metadata deletion, R2/local object deletion, main route authorization, Spite proxy/protection behavior, and the UI request carrying `projectId`. No dependency or migration is added.
