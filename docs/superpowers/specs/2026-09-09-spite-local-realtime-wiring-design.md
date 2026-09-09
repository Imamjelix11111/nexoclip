# Spite Local Realtime Wiring Design

## Goal
Make the CRDT canvas connect to an explicitly configured local Hocuspocus server and obtain a short-lived, project-bound realtime token from an authenticated App Router endpoint.

## Scope

- Resolve the browser WebSocket URL from `NEXT_PUBLIC_REALTIME_URL` when it is configured; retain the existing same-origin `/spite/ws` fallback for reverse-proxy deployments.
- Add `POST /api/auth/realtime-token`.
- Require trusted main-session authentication and verify that the authenticated user owns the requested project before issuing a 60-second token using `REALTIME_TOKEN_SECRET`.
- Return unauthorized requests as 401, non-owned projects as 404, invalid request bodies as 400, and missing server secret as 500 without exposing it.
- Test URL resolution and all token-route authorization outcomes.

## Data Flow

1. The canvas creates a `RealtimeCanvasRoom`.
2. It resolves `NEXT_PUBLIC_REALTIME_URL` to `ws://127.0.0.1:3008` in local development; otherwise it uses the existing same-origin `/spite/ws` URL.
3. Hocuspocus invokes the provider token callback.
4. The callback posts the project ID to `/api/auth/realtime-token`.
5. The route derives the user only from the server-side session, checks `projects.id + projects.userid`, then signs a room-bound JWT.
6. The client presents that JWT when opening the WebSocket to the realtime server.

## Error Handling

The client keeps the provider's existing connection behavior. The token route rejects unauthenticated or unauthorized requests before signing. It does not accept a browser-supplied user ID and never returns secret configuration.

## Validation

Run focused Node tests for URL resolution and the route handler, then the service test suites and `npm run build`. Restart the local Next server with `NEXT_PUBLIC_REALTIME_URL=ws://127.0.0.1:3008` and verify the token route plus WebSocket listener.
