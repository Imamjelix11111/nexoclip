# Canvas Regeneration Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make active Image/Video regeneration unmistakable while keeping the previous successful media visible, and notify the user exactly once when the newest generation succeeds or fails.

**Architecture:** Add a small shared presentation module that derives overlay/border/toast behavior from durable generation state, then consume it from both existing node components. Keep `outputUrl` intact when a replacement starts, use the newest durable status for Jobs Panel/polling, and deduplicate Sonner notifications by generation ID in component refs.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Sonner, Node test runner, Docker Compose.

## Global Constraints

- Apply identical state semantics to Image Node and Video Node.
- Preserve previous media throughout queued, processing, and failed replacement generations.
- Durable generation state remains authoritative; no database/schema/API changes.
- Active regeneration uses the approved dark overlay, amber/orange frame, spinner, `REGENERATING`, and `Generating new result…` copy.
- Failed regeneration uses a red overlay, provider error, and keyboard-accessible Retry action.
- Terminal Sonner notifications emit at most once per generation ID and do not replay old terminal jobs after page refresh.
- Animation must respect `prefers-reduced-motion`.
- Do not commit, push, or deploy without explicit user authorization.

---

## File Structure

- Create `nexoclip-app/services/spite/components/canvas/nodes/generation-feedback.tsx`: shared state derivation, overlay UI, and terminal-toast decision helper.
- Create `nexoclip-app/services/spite/lib/generation-feedback.test.ts`: pure behavior and server-rendered markup tests for first generation, regeneration, failure, and notification deduplication.
- Modify `nexoclip-app/services/spite/components/canvas/nodes/image-node.tsx`: preserve old image, restore polling with an old output, render feedback, Retry, and Sonner transitions.
- Modify `nexoclip-app/services/spite/components/canvas/nodes/video-node.tsx`: apply the same behavior to video.
- Modify `nexoclip-app/services/spite/lib/generation-node-prop-sync.test.ts`: assert both nodes resume active durable replacement jobs even when an output already exists.

### Task 1: Shared Regeneration Presentation

**Files:**
- Create: `nexoclip-app/services/spite/components/canvas/nodes/generation-feedback.tsx`
- Create: `nexoclip-app/services/spite/lib/generation-feedback.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type FeedbackGenerationStatus = 'idle' | 'submitting' | 'in_queue' | 'in_progress' | 'completed' | 'failed'

  type GenerationFeedbackState = {
    isActive: boolean
    isRegenerating: boolean
    isFailedRegeneration: boolean
    frameStyle: React.CSSProperties
  }

  function getGenerationFeedbackState(input: {
    status: FeedbackGenerationStatus
    hasOutput: boolean
  }): GenerationFeedbackState

  function getTerminalGenerationToast(input: {
    mediaKind: 'image' | 'video'
    generationId: string | null
    generationStatus: unknown
    error: string | null
    isRegeneration: boolean
    lastAnnouncedGenerationId: string | null
  }): { generationId: string; tone: 'success' | 'error'; message: string } | null

  function GenerationFeedbackOverlay(props: {
    state: GenerationFeedbackState
    error: string | null
    onRetry: () => void
  }): React.ReactNode
  ```

- [ ] **Step 1: Write failing state and notification tests**

  Test these exact cases:

  ```ts
  assert.deepEqual(
    getGenerationFeedbackState({ status: 'in_progress', hasOutput: true }),
    {
      isActive: true,
      isRegenerating: true,
      isFailedRegeneration: false,
      frameStyle: {
        border: '1.5px solid rgba(245,158,11,0.9)',
        boxShadow: '0 0 0 1px rgba(245,158,11,0.2), 0 0 24px rgba(245,158,11,0.25)',
      },
    },
  )
  assert.equal(getGenerationFeedbackState({ status: 'in_progress', hasOutput: false }).isRegenerating, false)
  assert.equal(getGenerationFeedbackState({ status: 'failed', hasOutput: true }).isFailedRegeneration, true)

  const success = getTerminalGenerationToast({
    mediaKind: 'image', generationId: 'g-1', generationStatus: 'completed',
    error: null, isRegeneration: true, lastAnnouncedGenerationId: null,
  })
  assert.deepEqual(success, {
    generationId: 'g-1', tone: 'success', message: 'Image regenerated successfully',
  })
  assert.equal(getTerminalGenerationToast({
    mediaKind: 'image', generationId: 'g-1', generationStatus: 'completed',
    error: null, isRegeneration: true, lastAnnouncedGenerationId: 'g-1',
  }), null)
  ```

  Also assert that failed video copy includes its supplied provider error and a missing/active generation ID produces no terminal notification.

- [ ] **Step 2: Run the focused test and verify RED**

  Run:
  ```bash
  cd nexoclip-app/services/spite && rtk node --import tsx --test lib/generation-feedback.test.ts
  ```
  Expected: FAIL because `generation-feedback.tsx` does not exist.

- [ ] **Step 3: Implement minimal shared state derivation and toast decision**

  Treat `submitting`, `in_queue`, and `in_progress` as active. Only combine active/failed state with `hasOutput` to classify a replacement. Return no toast unless status is `completed` or `failed`, a generation ID exists, and it differs from `lastAnnouncedGenerationId`.

- [ ] **Step 4: Add the approved overlay markup**

  Render active regeneration as an absolute dark layer over the media with:
  ```tsx
  <CircleNotch className="motion-safe:animate-spin" aria-hidden />
  <span>Generating new result…</span>
  <span>REGENERATING</span>
  ```

  Render failed regeneration with `role="alert"`, the error text, and:
  ```tsx
  <button type="button" onClick={onRetry}>Retry</button>
  ```

  The overlay must use `pointer-events-none` except for Retry (`pointer-events-auto`) so normal media controls cannot accidentally start actions while generating.

- [ ] **Step 5: Assert server-rendered overlay semantics**

  Use `renderToStaticMarkup` to assert active markup contains `REGENERATING` and `Generating new result…`, failure markup contains `role="alert"` and `Retry`, and first-generation active state does not render the replacement overlay.

- [ ] **Step 6: Run the focused test and verify GREEN**

  Run:
  ```bash
  cd nexoclip-app/services/spite && rtk node --import tsx --test lib/generation-feedback.test.ts
  ```
  Expected: all feedback tests pass.

### Task 2: Integrate Image and Video Nodes

**Files:**
- Modify: `nexoclip-app/services/spite/components/canvas/nodes/image-node.tsx`
- Modify: `nexoclip-app/services/spite/components/canvas/nodes/video-node.tsx`
- Modify: `nexoclip-app/services/spite/lib/generation-node-prop-sync.test.ts`

**Interfaces:**
- Consumes: `getGenerationFeedbackState`, `getTerminalGenerationToast`, and `GenerationFeedbackOverlay` from Task 1.
- Produces: identical replacement-generation behavior in Image and Video nodes.

- [ ] **Step 1: Extend source integration tests and verify RED**

  For both node sources assert:

  ```ts
  assert.doesNotMatch(source, /setOutputUrl\(null\)/)
  assert.match(source, /if \(pending && active && !generationId\)/)
  assert.match(source, /<GenerationFeedbackOverlay/)
  assert.match(source, /getTerminalGenerationToast/)
  ```

  Run:
  ```bash
  cd nexoclip-app/services/spite && rtk node --import tsx --test lib/generation-node-prop-sync.test.ts
  ```
  Expected: FAIL while nodes still clear output and suppress resume polling when old output exists.

- [ ] **Step 2: Preserve previous media on submit**

  Remove `setOutputUrl(null)` from both `handleGenerate` functions. Compute before submission:
  ```ts
  const isReplacement = Boolean(outputUrl)
  regenerationRef.current = isReplacement
  ```

  Keep the current output untouched on submission errors and terminal failures. A completed poll remains the only path that swaps in a new URL.

- [ ] **Step 3: Restore durable replacement polling after refresh**

  Change both mount-time guards from:
  ```ts
  if (pending && active && !outputUrl && !generationId)
  ```
  to:
  ```ts
  if (pending && active && !generationId)
  ```

  Set `regenerationRef.current = Boolean(outputUrl)` before restoring `generationId`. This lets an active replacement continue polling while the old output remains rendered.

- [ ] **Step 4: Render the amber frame and overlay**

  Derive:
  ```ts
  const feedbackState = getGenerationFeedbackState({ status, hasOutput: Boolean(outputUrl) })
  ```

  Give `feedbackState.frameStyle` precedence over selected/shot frame styles only while replacement is active or failed. Render `GenerationFeedbackOverlay` inside the relative preview after the image/video element. Pass `requestGenerate` as Retry so existing duplicate-submit and prompt validation remain centralized.

- [ ] **Step 5: Add deduplicated terminal Sonner notifications**

  Initialize refs so old terminal state does not replay on mount:
  ```ts
  const mountedRef = useRef(false)
  const lastAnnouncedGenerationRef = useRef<string | null>(null)
  const regenerationRef = useRef(false)
  ```

  In an effect keyed by durable terminal state and terminal ID (`data.lastGenerationId || data.generationId`), skip the first mounted observation, call `getTerminalGenerationToast`, then invoke `toast.success` or `toast.error` with stable ID:
  ```ts
  const toastId = `${id}-${notice.generationId}-terminal`
  ```

  Record `lastAnnouncedGenerationRef.current` before calling Sonner. Do not infer a notification only from `outputUrl`, because realtime and polling may update it repeatedly.

- [ ] **Step 6: Notify immediate submission failures**

  For validation/provider submission paths that end in `setStatus('failed')` before a durable generation ID exists, call `toast.error(errorMessage, { id: `${id}-submission-error` })`. Reuse the exact visible error; do not replace actionable provider text with a generic message.

- [ ] **Step 7: Run focused Canvas tests**

  Run:
  ```bash
  cd nexoclip-app/services/spite && rtk node --import tsx --test \
    lib/generation-feedback.test.ts \
    lib/generation-node-prop-sync.test.ts \
    lib/generation-node.test.ts \
    lib/durable-generation.test.ts \
    lib/canvas-node-interactions.test.ts
  ```
  Expected: all focused tests pass.

- [ ] **Step 8: Run the Spite production build**

  Run:
  ```bash
  cd nexoclip-app/services/spite && rtk npm run build
  ```
  Expected: Next.js production build succeeds. Restore `next-env.d.ts` if Next rewrites its generated import.

### Task 3: Local Docker Verification

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: completed Image/Video UI bundle from Tasks 1–2.
- Produces: verified local runtime at `http://localhost/spite`.

- [ ] **Step 1: Review the final diff**

  Run:
  ```bash
  rtk git diff --check
  rtk git diff -- \
    nexoclip-app/services/spite/components/canvas/nodes/generation-feedback.tsx \
    nexoclip-app/services/spite/components/canvas/nodes/image-node.tsx \
    nexoclip-app/services/spite/components/canvas/nodes/video-node.tsx \
    nexoclip-app/services/spite/lib/generation-feedback.test.ts \
    nexoclip-app/services/spite/lib/generation-node-prop-sync.test.ts
  ```
  Expected: no whitespace errors; diff contains no backend/schema changes.

- [ ] **Step 2: Rebuild and restart only Spite**

  Run:
  ```bash
  rtk docker compose build spite && rtk docker compose up -d --no-deps spite
  ```
  Expected: `nexoclip-spite` is recreated without touching databases, Redis, workers, or asset volumes.

- [ ] **Step 3: Smoke-test service health**

  Run:
  ```bash
  rtk curl -i http://localhost/spite/healthz
  rtk docker compose ps spite caddy
  rtk docker compose logs --tail=80 spite
  ```
  Expected: `/spite/healthz` returns `200 {"ok":true}`, containers are Up, and startup logs contain no runtime errors.

- [ ] **Step 4: Browser behavior check**

  With an existing Image or Video output, click Generate and verify the old media remains visible beneath the dark overlay, the amber frame and `REGENERATING` badge remain until terminal status, success swaps media and emits one Sonner toast, and failure retains old media with red Retry overlay and one actionable Sonner toast.
