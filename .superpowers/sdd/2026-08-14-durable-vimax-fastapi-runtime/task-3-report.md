# Task 3 Report: BullMQ storyboard worker

## Scope

Implemented only the requested Task 3 application files. Unrelated existing dirty files (Compose, UI, auth, credits, plan, and credit-pricing files) were not modified or staged.

## TDD evidence

### Red

1. `cd nexoclip-app && node --test tests/queue/bullmqGenerationQueue.test.mjs`
   - Failed because `src/queue/bullmqGenerationQueue.js` did not exist.
2. `cd nexoclip-app && node --test tests/queue/storyboardRuntimeClient.test.mjs`
   - Failed because `src/queue/storyboardRuntimeClient.js` did not exist.
3. `cd nexoclip-app && node --test tests/queue/storyboardWorker.test.mjs`
   - Failed because `src/queue/storyboardWorker.mjs` did not exist.
4. Added an input allowlist assertion to the runtime-client test; it failed while the client forwarded an unknown input field, then passed after allowlisting worker-owned parameters.

### Green

- Adapter test passed after installing BullMQ and implementing the producer/worker adapter.
- Runtime client test passed after implementing timed, authenticated structured requests and safe non-2xx errors.
- Worker test passed after implementing config validation, startup recovery, push processing, and ordered graceful shutdown.
- Final required Task 3 suite passed:

```text
cd nexoclip-app && node --test tests/queue/generationWorker.test.mjs tests/queue/generationWorkerState.test.mjs tests/queue/bullmqGenerationQueue.test.mjs tests/queue/storyboardRuntimeClient.test.mjs tests/queue/storyboardWorker.test.mjs
pass 11
fail 0
```

## Files

- `nexoclip-app/package.json`
- `nexoclip-app/package-lock.json`
- `nexoclip-app/src/queue/bullmqGenerationQueue.js`
- `nexoclip-app/src/queue/storyboardRuntimeClient.js`
- `nexoclip-app/src/queue/storyboardWorker.mjs`
- `nexoclip-app/tests/queue/bullmqGenerationQueue.test.mjs`
- `nexoclip-app/tests/queue/storyboardRuntimeClient.test.mjs`
- `nexoclip-app/tests/queue/storyboardWorker.test.mjs`

## Implementation notes

- BullMQ transport exposes enqueue, push-worker creation, and close; it intentionally has no polling `dequeue` method.
- Deterministic job IDs use the publisher idempotency key. Duplicate-add errors matching known already-exists semantics are treated as an idempotent success.
- The production processor uses BullMQ push delivery and performs atomic PostgreSQL claim, execution, transition/retry/failure, and credit settlement directly; it does not adapt BullMQ to polling.
- Runtime requests use `AbortSignal.timeout`, JSON content type, service-token header, a kind-specific input allowlist, and status-only safe failures that never echo response body or token.
- The worker validates env names without values, uses one ioredis connection supplied to BullMQ, recovers queued generations at startup and every 30 seconds, bounds concurrency to 1–32, and pauses before closing worker, queue, Redis, and pool on shutdown.

## Concerns

- The worker's recovery interval is intentionally fixed at 30 seconds for this task; Compose/topology configuration remains Task 4 scope.
- BullMQ/ioredis package installation reports pre-existing dependency audit findings (32 vulnerabilities); no audit remediation was performed because it is outside Task 3 scope.

## Commit

`8ce72d6020e735df7a5b2d52117413196d255a36` — `feat: run storyboard jobs through BullMQ`

---

## Reviewer-finding fix evidence

### Red

1. `cd nexoclip-app && node --test tests/queue/bullmqGenerationQueue.test.mjs`
   - Failed when the new test passed publisher key `generation:g1` into BullMQ validation: the previous adapter used that colon-containing key as `jobId`.
2. `cd nexoclip-app && node --test tests/queue/storyboardRuntimeClient.test.mjs`
   - Failed for both `AbortError` and a rejected network fetch because the original errors escaped without retryable provider codes.
3. `cd nexoclip-app && node --test tests/queue/storyboardWorker.test.mjs`
   - Failed because the production processor was not exported/injectable; the new tests could not invoke its real claim/transition path.

### Green

- BullMQ IDs now deterministically map the publisher key using base64url (`id-` prefix), preserving the publisher idempotency identity while excluding `:`. The adapter test invokes BullMQ v6's own `Job.validateOptions` and verifies enqueue options.
- Removed duplicate-error swallowing entirely. BullMQ duplicate custom IDs are naturally idempotent; Redis/network failures now propagate to the publisher and release its DB claim.
- Runtime transport failures become safe, retryable `PROVIDER_TIMEOUT` or `PROVIDER_UNAVAILABLE` failures. The processor therefore persists retry state for recovery rather than terminally failing a transient outage.
- Extracted the established `createGenerationProcessor` from the polling wrapper and reused it in the BullMQ worker. Production-processor tests invoke this handler directly and cover atomic duplicate claim, success settlement transition, retry persistence, and terminal failure/release path.

Final Task 3 suite:

```text
cd nexoclip-app && node --test tests/queue/generationWorker.test.mjs tests/queue/generationWorkerState.test.mjs tests/queue/bullmqGenerationQueue.test.mjs tests/queue/storyboardRuntimeClient.test.mjs tests/queue/storyboardWorker.test.mjs
pass 18
fail 0
```

### Remaining concern

The Node suite emits pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warnings for the application’s ESM source. They do not fail the suite; changing package module mode is outside Task 3 scope.
