# SPITE Sidebar Link Design

## Goal

Replace the NexoClip sidebar's **AI Canvas Mode** entry with **SPITE**, linking to the separately running SPITE service.

## Design

- Keep the existing sidebar position and canvas icon.
- Replace the `workflows` sidebar entry with a dedicated external SPITE entry.
- Resolve its URL from `NEXT_PUBLIC_SPITE_URL`, with `http://localhost:3005` as the local fallback.
- Use normal browser navigation in the same tab because SPITE may be hosted on a different origin; do not pass an external URL to Next.js `router.push`.
- Add `NEXT_PUBLIC_SPITE_URL=http://localhost:3005` to both `.env.example` and the ignored local `.env.local`.
- Do not modify SPITE authentication, database, generation code, or the paused OpenRouter migration.

## Error Handling

If the variable is absent, local development still targets `http://localhost:3005`. If SPITE is unavailable, the browser shows its normal connection error; NexoClip does not add a proxy or iframe fallback.

## Verification

- Confirm the sidebar renders **SPITE** and no longer renders **AI Canvas Mode**.
- Confirm the anchor target equals the configured URL.
- Run the relevant lint/build checks.
- Confirm `.env.local` remains ignored and no secrets are introduced.
