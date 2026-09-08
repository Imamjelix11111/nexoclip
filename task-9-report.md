# Task 9 Report — Hocuspocus Core

## Status
Implemented Task 9 core only:
- Hocuspocus websocket auth + room ownership enforcement
- private `POST /internal/authorize`
- `GET /healthz`
- atomic nonce insert before ownership lookup with replay rejection
- authorized-only hydration
- exact `onChange` enqueue into runtime
- disconnect connection-reference cleanup

Explicitly not implemented here:
- Awareness naming/sanitization
- durability status ACK flow
- read-only admission policy
- graceful shutdown orchestration

## Files
- `nexoclip-app/services/spite/realtime/server.ts`
- `nexoclip-app/services/spite/realtime/server-core.test.ts`

## TDD Notes
- RED verified first from missing `realtime/server.ts`
- Then implemented minimal core to satisfy real pinned Hocuspocus lifecycle tests
- Debugged a real provider test harness race/config issue (`autoConnect` event race + invalid `delay/minDelay` pairing) before final GREEN verification

## Verification
### Focused tests
```bash
cd nexoclip-app/services/spite
npx --yes tsx --test realtime/auth.test.ts realtime/server-core.test.ts
```
Result: 9/9 passing

### TypeScript
```bash
cd nexoclip-app/services/spite
tsc --noEmit
```
Result: no errors

## Security Invariant Covered
The core lifecycle tests assert that invalid, expired, non-owner, and wrong-project websocket attempts receive:
- no room access
- no repository hydration
- no sync bytes/state hydration

The internal auth tests assert:
- nonce insert happens before ownership lookup
- replay is rejected
- replay does not perform a second ownership lookup

## Concerns / Follow-ups
1. Hocuspocus currently logs `[onAuthenticate] ...` messages for rejected auth attempts during tests; behavior is expected from upstream hook error handling.
2. Node emits an experimental `localStorage` warning during provider-based tests in this harness; tests still pass and TypeScript is clean.
3. Task 10 still needs lifecycle extras: Awareness identity/naming, durable status ACKs, read-only admission behavior, and shutdown flush/teardown.
