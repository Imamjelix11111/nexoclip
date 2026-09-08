# Seedance 2.5 Unfiltered Video Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete, ByteDance-branded Seedance 2.5 Unfiltered family to Video Studio with correct mode-specific controls and durable SaaS routing.

**Architecture:** Extend the static Studio registry because Video Studio already derives model tabs, provider icons, input affordances, capabilities, and SaaS ID mappings from it. Each new entry maps to the existing BytePlus unfiltered deployment, while the existing durable generation API and isolated video worker remain unchanged.

**Tech Stack:** React client components, static JavaScript model registry, Node.js test runner, BytePlus provider routing.

## Global Constraints

- Use `provider: "bytedance"` and `provider_name: "ByteDance"` for every Unfiltered entry.
- Map every Unfiltered Studio ID to `ep-20260904190604-p8pjl`.
- Preserve SaaS-only submission; do not add browser API keys or direct provider calls.
- Retain provider-side moderation as authoritative.
- Do not modify the provisional 10-credit video price.
- Run commands through `rtk` where a dedicated filter exists.

---

### Task 1: Add the complete Unfiltered registry family

**Files:**
- Modify: `packages/studio/src/models.js`
- Test: `tests/providers/byteplusModelRegistry.test.mjs`
- Test: `tests/providers/videoStudioModelFilters.test.mjs`

**Interfaces:**
- Consumes: existing `t2vModels`, `i2vModels`, `OPENROUTER_VIDEO_MODEL_MAP`, `OPENROUTER_MULTI_REFERENCE_MODELS`, `getModesForModel` conventions.
- Produces: eight catalog IDs mapped to `ep-20260904190604-p8pjl` with ByteDance metadata.

- [ ] **Step 1: Write failing registry expectations**

Add a table-driven test with these IDs and category expectations:

```js
const expected = {
  'seedance-2.5-unfiltered-text-to-video': 't2v',
  'seedance-2.5-unfiltered-text-to-video-480p': 't2v',
  'seedance-2.5-unfiltered-image-to-video': 'i2v',
  'seedance-2.5-unfiltered-image-to-video-480p': 'i2v',
  'seedance-2.5-unfiltered-first-last-frame': 'i2v',
  'seedance-2.5-unfiltered-first-last-frame-480p': 'i2v',
  'seedance-2.5-unfiltered-omni-reference': 'i2v',
  'seedance-2.5-unfiltered-omni-reference-480p': 'i2v',
};
```

For every entry assert `provider === 'bytedance'`, `provider_name === 'ByteDance'`, and `OPENROUTER_VIDEO_MODEL_MAP[id] === 'ep-20260904190604-p8pjl'`. Assert 480p entries have `inputs.resolution.enum` equal to `['480p']`; assert first-last has `lastImageField`; assert omni IDs are in `OPENROUTER_MULTI_REFERENCE_MODELS`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
rtk node --test tests/providers/byteplusModelRegistry.test.mjs tests/providers/videoStudioModelFilters.test.mjs
```

Expected: FAIL because the missing IDs are not in the registry/mapping.

- [ ] **Step 3: Add the eight registry entries and mappings**

In `packages/studio/src/models.js`:

1. Change the existing Unfiltered T2V and I2V metadata from `byteplus`/`BytePlus` to `bytedance`/`ByteDance`.
2. Add 480p catalog variants with `inputs.resolution.enum: ['480p']`.
3. Add first-last variants with `imageField: 'image_url'` and `lastImageField: 'last_image'`.
4. Add omni variants with `imageField: 'image_url'`, the existing multi-reference convention, and compatible ratio/duration metadata.
5. Add all IDs to `OPENROUTER_VIDEO_MODEL_MAP` with deployment `ep-20260904190604-p8pjl`.
6. Add only omni IDs to `OPENROUTER_MULTI_REFERENCE_MODELS`.

Use names that distinguish mode and low-resolution variant, for example `Seedance 2.5 Unfiltered First & Last Frame 480p`.

- [ ] **Step 4: Run focused tests to verify they pass**

Run:

```bash
rtk node --test tests/providers/byteplusModelRegistry.test.mjs tests/providers/videoStudioModelFilters.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the isolated registry change**

```bash
rtk git add packages/studio/src/models.js tests/providers/byteplusModelRegistry.test.mjs tests/providers/videoStudioModelFilters.test.mjs
rtk git commit -m "feat(video): add unfiltered Seedance family"
```

### Task 2: Verify Video Studio logo and mode contracts

**Files:**
- Test: `tests/frontend/videoSaasClient.test.mjs`
- Test: `tests/providers/videoStudioModelFilters.test.mjs`
- Modify only if failing: `packages/studio/src/components/VideoStudio.jsx`

**Interfaces:**
- Consumes: `PROVIDER_LOGOS.bytedance`, registry `provider` values, `getModesForModel`, and `OPENROUTER_MULTI_REFERENCE_MODELS`.
- Produces: Unfiltered entries display the ByteDance image and use the correct image/frame/reference controls without custom rendering paths.

- [ ] **Step 1: Write a failing source-contract test**

Add assertions that the Video Studio source contains:

```js
bytedance: "https://cdn.muapi.ai/models/bytedance.png"
```

and that Unfiltered registry entries have `provider: 'bytedance'`. Import and assert `getModesForModel('seedance-2.5-unfiltered-first-last-frame')` includes the image-to-video path and `getMaxImagesForI2VModel('seedance-2.5-unfiltered-omni-reference') > 1`.

- [ ] **Step 2: Run the contract test to verify its initial state**

Run:

```bash
rtk node --test tests/frontend/videoSaasClient.test.mjs tests/providers/videoStudioModelFilters.test.mjs
```

Expected: PASS after Task 1. If it fails, use the failure to make the minimum registry or existing UI helper correction.

- [ ] **Step 3: Keep UI code unchanged unless a contract fails**

Do not add special-case Unfiltered JSX. Its `provider: 'bytedance'` must select the existing logo branch:

```jsx
<img src={PROVIDER_LOGOS[m.provider]} alt={m.provider_name} />
```

Correct missing behavior in registry metadata first. Only update `VideoStudio.jsx` if its generic category logic cannot express the model’s required existing input mode.

- [ ] **Step 4: Run relevant regression tests**

Run:

```bash
rtk node --test tests/frontend/videoSaasClient.test.mjs tests/providers/videoStudioModelFilters.test.mjs tests/providers/byteplusModelRegistry.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit any contract/UI correction**

```bash
rtk git add packages/studio/src/components/VideoStudio.jsx tests/frontend/videoSaasClient.test.mjs tests/providers/videoStudioModelFilters.test.mjs
rtk git commit -m "test(video): cover unfiltered provider controls"
```

### Task 3: Final verification and runtime rollout

**Files:**
- Verify: `packages/studio/src/models.js`
- Verify: `packages/studio/src/components/VideoStudio.jsx`

**Interfaces:**
- Consumes: compiled Studio bundle and running SaaS app.
- Produces: deployable catalog update visible under ByteDance in Video Studio.

- [ ] **Step 1: Run the full targeted media suite**

Run:

```bash
rtk node --test tests/frontend/videoSaasClient.test.mjs tests/providers/videoStudioModelFilters.test.mjs tests/providers/byteplusModelRegistry.test.mjs tests/generations/videoReservation.test.mjs tests/generations/saasVideoGeneration.test.mjs tests/queue/separateMediaQueues.test.mjs tests/queue/videoWorker.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Check diff and accidental secret exposure**

Run:

```bash
rtk git diff --check
rtk git diff -- packages/studio/src/models.js packages/studio/src/components/VideoStudio.jsx
```

Expected: no whitespace errors and no credentials.

- [ ] **Step 3: Rebuild only the app service**

From `/Users/lovinsmwn/Documents/production/nexoclip` run:

```bash
docker compose up -d --build --no-deps --force-recreate nexoclip-app
```

Expected: `nexoclip-app` is Up. Do not recreate PostgreSQL, Redis, `ai-storyboard`, or workers because this is a browser registry-only change.

- [ ] **Step 4: Manually verify the catalog**

At `http://localhost:3000/studio/video`, open Model → ByteDance and confirm all eight Seedance 2.5 Unfiltered entries show the ByteDance logo. Select one of each mode and verify the visible controls:

```text
T2V: no upload
I2V: first image upload
First & Last: first and last image uploads
Omni: multiple reference images
480p: only 480p resolution
```

- [ ] **Step 5: Commit verification-only adjustments if any**

If no files changed after Task 2, do not create an empty commit. Otherwise, stage only intended files and use:

```bash
rtk git commit -m "fix(video): complete unfiltered model capabilities"
```
