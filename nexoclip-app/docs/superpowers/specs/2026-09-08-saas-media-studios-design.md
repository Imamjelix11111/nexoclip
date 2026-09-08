# SaaS Media Studios Design

## Goal
Migrate Cinema, AI Influencer, and Video Studio from browser/BYOK/MuAPI flows to the tenant-safe credited generation pipeline.

## Decisions
- Browser submits only to `POST /api/generations`; it never sends provider credentials.
- Cinema uses canonical `bytedance-seed/seedream-4.5` and the existing image worker.
- AI Influencer remains an image/portrait workflow and uses the same image worker with a server-routed SaaS model.
- Video uses a new persistent video worker. It submits to `providerRouter.submitVideo`, polls with `pollVideo`, downloads completed bytes, writes an asset, persists `generation_outputs`, and settles the existing reservation.
- Input assets are tenant-scoped. Browser download URLs are resolved to provider-readable data URLs in the worker; client-supplied workspace IDs authorize no access by themselves.
- Unsupported models/capabilities fail explicitly. No request may silently fall back to MuAPI or BYOK.

## Data flow
`Studio → /api/generations → reservation + generation job → BullMQ → worker → provider router → object storage + assets + generation_outputs → job status/history`.

## Error and recovery
Queue publication remains post-commit and recoverable. Workers claim jobs transactionally, retry retryable provider failures, expose only safe terminal messages, release failed reservations, and capture successful reservations.

## Verification
Test client submission contracts, worker submit/poll/download/persistence behavior, asset-reference isolation, explicit unsupported-model rejection, and durable output URLs.