# Video Studio OpenRouter-Only V2V Picker + Mapping Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Video Studio's V2V picker hanya menampilkan model yang punya fallback OpenRouter (mirror pola T2V/I2V yang sudah ada), dan `OPENROUTER_VIDEO_MODEL_MAP`/`OPENROUTER_MULTI_REFERENCE_MODELS` diperluas dengan mapping baru yang sudah diverifikasi lewat dokumentasi publik OpenRouter.

**Architecture:** `packages/studio/src/models.js` menambah `openRouterV2VModels` (filter `v2vModels` lewat `OPENROUTER_V2V_MODEL_MAP`, pola identik `openRouterT2VModels`/`openRouterI2VModels`) dan menambah entri baru ke `OPENROUTER_VIDEO_MODEL_MAP`/`OPENROUTER_MULTI_REFERENCE_MODELS`. `VideoStudio.jsx` diubah untuk pakai `openRouterV2VModels` di jalur pembentukan dropdown & default-model-selection saja — lookup by-id untuk history lama tetap pakai `v2vModels` mentah. Tidak ada perubahan di `muapi.js`: `processV2V`/`generateVideo`/`generateI2V` sudah cek map dulu baru fallback MuAPI.

**Tech Stack:** JavaScript ESM (`packages/studio/src/models.js`, `.jsx` React component), Node built-in test runner (`node --test tests/**/*.test.mjs`), tidak ada bundler/JSX compile step dibutuhkan untuk test data-layer karena `models.js` adalah ESM murni tanpa JSX.

## Global Constraints

- Filter picker bersifat **permanen** — tidak ada toggle on/off (keputusan user di spec).
- Verifikasi mapping baru **doc-based**, bukan live API call — risiko yang diterima, dicatat di doc ekspansi (spec bagian B).
- V2V hanya dipetakan ke `OPENROUTER_V2V_MODEL_MAP` kalau dokumentasi eksplisit menyebut dukungan video sebagai input; nama yang mirip saja tidak cukup (standar `seedance-2-watermark-remover`, lihat `docs/2026-08-24-muapi-dependency-audit.md`).
- Lookup by-id untuk history lama (`getV2VModelById`, `v2vModels.find(...)`, `t2vModels`/`i2vModels` yang dipakai `getCurrentModels()`) **tidak boleh diubah** — harus tetap resolve model yang sudah di-hide dari picker.
- Jangan mengubah perubahan user yang sudah ada: `Seedance2.0 Model Card.pdf` dan file/direktori untracked lain di working tree.

---

### Task 1: `openRouterV2VModels` export + test

**Files:**
- Modify: `nexoclip-app/packages/studio/src/models.js` (dekat `openRouterT2VModels`/`openRouterI2VModels`, ~baris 19479-19480)
- Create: `nexoclip-app/tests/providers/videoStudioModelFilters.test.mjs`

**Interfaces:**
- Consumes: `v2vModels` (array of `{ id, name, ... }`), `OPENROUTER_V2V_MODEL_MAP` (object, key = MuAPI id, value = OpenRouter model slug) — keduanya sudah ada di `models.js`.
- Produces: `openRouterV2VModels` — array, subset dari `v2vModels` yang `id`-nya ada sebagai key di `OPENROUTER_V2V_MODEL_MAP`. Dipakai Task 3 (component) dan test ini.

- [ ] **Step 1: Write the failing test**

```js
// nexoclip-app/tests/providers/videoStudioModelFilters.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  v2vModels,
  openRouterV2VModels,
  OPENROUTER_V2V_MODEL_MAP,
} from '../../packages/studio/src/models.js';

test('openRouterV2VModels only contains models present in OPENROUTER_V2V_MODEL_MAP', () => {
  assert.ok(openRouterV2VModels.length > 0, 'expected at least one mapped V2V model');
  for (const model of openRouterV2VModels) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(OPENROUTER_V2V_MODEL_MAP, model.id),
      `${model.id} should be a key in OPENROUTER_V2V_MODEL_MAP`,
    );
  }
});

test('openRouterV2VModels excludes pure-MuAPI V2V models with no OpenRouter mapping', () => {
  const unmapped = v2vModels.find((m) => !OPENROUTER_V2V_MODEL_MAP[m.id]);
  assert.ok(unmapped, 'fixture assumption broken: expected at least one unmapped v2v model to exist');
  assert.equal(
    openRouterV2VModels.some((m) => m.id === unmapped.id),
    false,
    `${unmapped.id} has no OpenRouter mapping and must not appear in openRouterV2VModels`,
  );
});

test('openRouterV2VModels includes the three known-mapped models', () => {
  const ids = openRouterV2VModels.map((m) => m.id);
  assert.ok(ids.includes('runway-aleph-v2v'));
  assert.ok(ids.includes('wan2.7-video-extend'));
  assert.ok(ids.includes('wan2.7-video-edit'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexoclip-app && node --test tests/providers/videoStudioModelFilters.test.mjs`
Expected: FAIL — `openRouterV2VModels` is not exported from `models.js` (`SyntaxError`/`undefined` import).

- [ ] **Step 3: Add the export**

In `nexoclip-app/packages/studio/src/models.js`, immediately after the existing line:

```js
export const openRouterI2VModels = i2vModels.filter((model) => OPENROUTER_VIDEO_MODEL_MAP[model.id]);
```

add:

```js
export const openRouterV2VModels = v2vModels.filter((model) => OPENROUTER_V2V_MODEL_MAP[model.id]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nexoclip-app && node --test tests/providers/videoStudioModelFilters.test.mjs`
Expected: PASS, 3 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
cd nexoclip-app
git add packages/studio/src/models.js tests/providers/videoStudioModelFilters.test.mjs
git commit -m "feat: add openRouterV2VModels filtered export"
```

---

### Task 2: Wire `openRouterV2VModels` into Video Studio's picker

**Files:**
- Modify: `nexoclip-app/packages/studio/src/components/VideoStudio.jsx`

**Interfaces:**
- Consumes: `openRouterV2VModels` (from Task 1, already exported by `models.js`).
- Produces: no new exports — this task only changes which array feeds the dropdown/default-selection UI. `v2vModels`, `getV2VModelById`, `getCurrentModels()` remain unchanged and keep resolving the full unfiltered list for history lookups.

This component has no existing automated test harness (no React Testing Library / jsdom setup in this package — confirmed via `packages/studio/package.json`, no test dependency present). Verification for this task is manual (Task 4 covers this end-to-end). Steps below are still one action each.

- [ ] **Step 1: Import `openRouterV2VModels`**

In `nexoclip-app/packages/studio/src/components/VideoStudio.jsx`, find the import block:

```js
import {
  t2vModels,
  i2vModels,
  v2vModels,
  openRouterT2VModels,
  openRouterI2VModels,
```

Change to:

```js
import {
  t2vModels,
  i2vModels,
  v2vModels,
  openRouterT2VModels,
  openRouterI2VModels,
  openRouterV2VModels,
```

- [ ] **Step 2: Use it in the dropdown's category entries**

Find (inside `ModelDropdown`, the `modelCategories` array):

```js
      entries: [
        ...openRouterT2VModels.map((model) => ({ model, category: "t2v" })),
        ...openRouterI2VModels.map((model) => ({ model, category: "i2v" })),
        ...v2vModels.map((model) => ({ model, category: "v2v" })),
      ],
```

Change the third line to:

```js
      entries: [
        ...openRouterT2VModels.map((model) => ({ model, category: "t2v" })),
        ...openRouterI2VModels.map((model) => ({ model, category: "i2v" })),
        ...openRouterV2VModels.map((model) => ({ model, category: "v2v" })),
      ],
```

And the standalone `"v2v"` category block right below it:

```js
    {
      id: "v2v",
      label: "Video Tools",
      entries: v2vModels.map((model) => ({ model, category: "v2v" })),
    },
```

becomes:

```js
    {
      id: "v2v",
      label: "Video Tools",
      entries: openRouterV2VModels.map((model) => ({ model, category: "v2v" })),
    },
```

- [ ] **Step 3: Use it for default-model auto-selection on video upload**

There are two identical blocks (video-drop handler and the "keep model & mode" fallback branch) that auto-pick the first V2V model when a user uploads a video without an explicit model chosen. Both currently read:

```js
        const firstV2V = v2vModels[0];
```

Change **both occurrences** to:

```js
        const firstV2V = openRouterV2VModels[0];
```

Do not change any other `v2vModels` reference in this file — `isMotionControlSelection` (`v2vModels.find(...)`), `getCurrentModels()` (`return v2vModels`), and the provider-icon lookup (`[...t2vModels, ...i2vModels, ...v2vModels]`) must keep resolving against the full list so history entries for now-hidden models still render.

- [ ] **Step 4: Grep-verify no unintended replacements**

Run: `cd nexoclip-app && grep -n "v2vModels" packages/studio/src/components/VideoStudio.jsx`
Expected output: exactly 2 lines contain `openRouterV2VModels` (the two `firstV2V` assignments) plus the import line; all other `v2vModels` occurrences are unchanged (raw list, used for lookups/lookups-by-id/`getCurrentModels`/provider icon). Cross-check against the list in Step 3's last paragraph — nothing else should have changed.

- [ ] **Step 5: Commit**

```bash
cd nexoclip-app
git add packages/studio/src/components/VideoStudio.jsx
git commit -m "feat: filter Video Studio V2V picker to OpenRouter-mapped models"
```

---

### Task 3: Expand `OPENROUTER_VIDEO_MODEL_MAP` + `OPENROUTER_MULTI_REFERENCE_MODELS`

**Files:**
- Modify: `nexoclip-app/packages/studio/src/models.js`
- Modify: `nexoclip-app/tests/providers/videoStudioModelFilters.test.mjs` (add cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `OPENROUTER_VIDEO_MODEL_MAP` and `OPENROUTER_MULTI_REFERENCE_MODELS` gain new keys/entries (both already exported, no signature change — same shape, more data). `openRouterT2VModels`/`openRouterI2VModels` (Task 1's sibling exports, already existing) automatically pick up the newly-mapped ids since they filter through this same map — no code change needed there.

**Verified mapping** (doc-based, checked against each model's public OpenRouter page on 2026-08-27 — see rationale doc created in Task 4 for the full trail, including candidates that were checked and deliberately excluded):

| MuAPI id | OpenRouter model | Multi-reference? |
|---|---|---|
| `kling-o1-text-to-video` | `kwaivgi/kling-video-o1` | no |
| `kling-o1-image-to-video` | `kwaivgi/kling-video-o1` | no |
| `kling-o1-reference-to-video` | `kwaivgi/kling-video-o1` | **yes** |
| `kling-o1-standard-image-to-video` | `kwaivgi/kling-video-o1` | no |
| `kling-o1-standard-reference-to-video` | `kwaivgi/kling-video-o1` | **yes** |
| `grok-imagine-text-to-video` | `x-ai/grok-imagine-video` | no |
| `grok-imagine-image-to-video` | `x-ai/grok-imagine-video` | no |
| `grok-imagine-video-1-5-preview` | `x-ai/grok-imagine-video-1.5` | no |
| `happy-horse-1-text-to-video-1080p` | `alibaba/happyhorse-1.0` | no |
| `happy-horse-1-text-to-video-720p` | `alibaba/happyhorse-1.0` | no |
| `happy-horse-1-image-to-video-1080p` | `alibaba/happyhorse-1.0` | no |
| `happy-horse-1-image-to-video-720p` | `alibaba/happyhorse-1.0` | no |
| `happy-horse-1-reference-to-video-1080p` | `alibaba/happyhorse-1.0` | **yes** |
| `happy-horse-1-reference-to-video-720p` | `alibaba/happyhorse-1.0` | **yes** |
| `happy-horse-1.1-text-to-video-1080p` | `alibaba/happyhorse-1.1` | no |
| `happy-horse-1.1-text-to-video-720p` | `alibaba/happyhorse-1.1` | no |
| `happy-horse-1.1-image-to-video-1080p` | `alibaba/happyhorse-1.1` | no |
| `happy-horse-1.1-image-to-video-720p` | `alibaba/happyhorse-1.1` | no |
| `happy-horse-1.1-reference-to-video-1080p` | `alibaba/happyhorse-1.1` | **yes** |
| `happy-horse-1.1-reference-to-video-720p` | `alibaba/happyhorse-1.1` | **yes** |
| `wan2.6-text-to-video` | `alibaba/wan-2.6` | no |
| `wan2.6-image-to-video` | `alibaba/wan-2.6` | no |
| `seedance-2.5-text-to-video` | `bytedance/seedance-2.5` | no |
| `seedance-2.5-text-to-video-480p` | `bytedance/seedance-2.5` | no |
| `seedance-2.5-image-to-video` | `bytedance/seedance-2.5` | no |
| `seedance-2.5-image-to-video-480p` | `bytedance/seedance-2.5` | no |
| `seedance-2.5-first-last-frame` | `bytedance/seedance-2.5` | no |
| `seedance-2.5-first-last-frame-480p` | `bytedance/seedance-2.5` | no |
| `seedance-2.5-omni-reference` | `bytedance/seedance-2.5` | **yes** |
| `seedance-2.5-omni-reference-480p` | `bytedance/seedance-2.5` | **yes** |
| `seedance-2-text-to-video-fast` | `bytedance/seedance-2.0-fast` | no |
| `seedance-2-image-to-video-fast` | `bytedance/seedance-2.0-fast` | no |

No new `OPENROUTER_V2V_MODEL_MAP` entries this pass — every V2V-shaped MuAPI id that name-matched a new OpenRouter candidate (`kling-o1-video-edit*`, `happy-horse-*-video-edit-*`) was checked against that model's public docs, which describe text/image input only, not video input. `OPENROUTER_V2V_MODEL_MAP` stays at its existing 3 entries (`runway-aleph-v2v`, `wan2.7-video-extend`, `wan2.7-video-edit`).

Deliberately **not mapped** (no matching MuAPI id exists in `t2vModels`/`i2vModels`/`v2vModels` today — nothing to point these at): `alibaba/wan-3.0`, `heygen/avatar-iv`, `black-forest-labs/flux-video-upscale`, `black-forest-labs/flux-3-video`, `minimax/hailuo-3`, `runway/gen-4.5` (MuAPI has `runway-text-to-video`/`runway-image-to-video` but no version-specific id confirms these are Gen-4.5 rather than an older Gen-3/Gen-4 model — mapping them would risk silently changing which Runway version a user's job actually runs on, so left unmapped pending a version-confirmed MuAPI id).

- [ ] **Step 1: Write the failing test cases**

Append to `nexoclip-app/tests/providers/videoStudioModelFilters.test.mjs`:

```js
import { OPENROUTER_VIDEO_MODEL_MAP, OPENROUTER_MULTI_REFERENCE_MODELS } from '../../packages/studio/src/models.js';

test('OPENROUTER_VIDEO_MODEL_MAP includes the new T2V/I2V mappings', () => {
  const expected = {
    'kling-o1-text-to-video': 'kwaivgi/kling-video-o1',
    'kling-o1-image-to-video': 'kwaivgi/kling-video-o1',
    'kling-o1-reference-to-video': 'kwaivgi/kling-video-o1',
    'kling-o1-standard-image-to-video': 'kwaivgi/kling-video-o1',
    'kling-o1-standard-reference-to-video': 'kwaivgi/kling-video-o1',
    'grok-imagine-text-to-video': 'x-ai/grok-imagine-video',
    'grok-imagine-image-to-video': 'x-ai/grok-imagine-video',
    'grok-imagine-video-1-5-preview': 'x-ai/grok-imagine-video-1.5',
    'happy-horse-1-text-to-video-1080p': 'alibaba/happyhorse-1.0',
    'happy-horse-1-text-to-video-720p': 'alibaba/happyhorse-1.0',
    'happy-horse-1-image-to-video-1080p': 'alibaba/happyhorse-1.0',
    'happy-horse-1-image-to-video-720p': 'alibaba/happyhorse-1.0',
    'happy-horse-1-reference-to-video-1080p': 'alibaba/happyhorse-1.0',
    'happy-horse-1-reference-to-video-720p': 'alibaba/happyhorse-1.0',
    'happy-horse-1.1-text-to-video-1080p': 'alibaba/happyhorse-1.1',
    'happy-horse-1.1-text-to-video-720p': 'alibaba/happyhorse-1.1',
    'happy-horse-1.1-image-to-video-1080p': 'alibaba/happyhorse-1.1',
    'happy-horse-1.1-image-to-video-720p': 'alibaba/happyhorse-1.1',
    'happy-horse-1.1-reference-to-video-1080p': 'alibaba/happyhorse-1.1',
    'happy-horse-1.1-reference-to-video-720p': 'alibaba/happyhorse-1.1',
    'wan2.6-text-to-video': 'alibaba/wan-2.6',
    'wan2.6-image-to-video': 'alibaba/wan-2.6',
    'seedance-2.5-text-to-video': 'bytedance/seedance-2.5',
    'seedance-2.5-text-to-video-480p': 'bytedance/seedance-2.5',
    'seedance-2.5-image-to-video': 'bytedance/seedance-2.5',
    'seedance-2.5-image-to-video-480p': 'bytedance/seedance-2.5',
    'seedance-2.5-first-last-frame': 'bytedance/seedance-2.5',
    'seedance-2.5-first-last-frame-480p': 'bytedance/seedance-2.5',
    'seedance-2.5-omni-reference': 'bytedance/seedance-2.5',
    'seedance-2.5-omni-reference-480p': 'bytedance/seedance-2.5',
    'seedance-2-text-to-video-fast': 'bytedance/seedance-2.0-fast',
    'seedance-2-image-to-video-fast': 'bytedance/seedance-2.0-fast',
  };
  for (const [muapiId, openRouterModel] of Object.entries(expected)) {
    assert.equal(OPENROUTER_VIDEO_MODEL_MAP[muapiId], openRouterModel, `mapping for ${muapiId}`);
  }
});

test('reference-to-video / omni-reference ids are flagged as multi-reference', () => {
  const expectedMultiRef = [
    'kling-o1-reference-to-video',
    'kling-o1-standard-reference-to-video',
    'happy-horse-1-reference-to-video-1080p',
    'happy-horse-1-reference-to-video-720p',
    'happy-horse-1.1-reference-to-video-1080p',
    'happy-horse-1.1-reference-to-video-720p',
    'seedance-2.5-omni-reference',
    'seedance-2.5-omni-reference-480p',
  ];
  for (const id of expectedMultiRef) {
    assert.ok(OPENROUTER_MULTI_REFERENCE_MODELS.has(id), `${id} should be in OPENROUTER_MULTI_REFERENCE_MODELS`);
  }
});

test('first-last-frame and plain image-to-video ids are NOT flagged as multi-reference', () => {
  const notMultiRef = [
    'seedance-2.5-first-last-frame',
    'seedance-2.5-first-last-frame-480p',
    'kling-o1-image-to-video',
    'happy-horse-1.1-image-to-video-1080p',
    'wan2.6-image-to-video',
  ];
  for (const id of notMultiRef) {
    assert.equal(OPENROUTER_MULTI_REFERENCE_MODELS.has(id), false, `${id} should NOT be in OPENROUTER_MULTI_REFERENCE_MODELS`);
  }
});

test('no new OPENROUTER_V2V_MODEL_MAP entries were added this pass', () => {
  assert.deepEqual(Object.keys(OPENROUTER_V2V_MODEL_MAP).sort(), [
    'runway-aleph-v2v',
    'wan2.7-video-edit',
    'wan2.7-video-extend',
  ]);
});
```

(Add the `OPENROUTER_V2V_MODEL_MAP` import to the existing import line at the top of the test file if not already present from Task 1.)

- [ ] **Step 2: Run tests to verify the new cases fail**

Run: `cd nexoclip-app && node --test tests/providers/videoStudioModelFilters.test.mjs`
Expected: the 3 tests from Task 1 still PASS; the 4 new tests FAIL (missing keys / missing Set entries).

- [ ] **Step 3: Add the new map entries**

In `nexoclip-app/packages/studio/src/models.js`, extend `OPENROUTER_VIDEO_MODEL_MAP` (the object literal ending `'seedance-2-mini-image-to-video': 'bytedance/seedance-2.0-mini',\n};`) by inserting the following entries before the closing `};`:

```js
  'kling-o1-text-to-video': 'kwaivgi/kling-video-o1',
  'kling-o1-image-to-video': 'kwaivgi/kling-video-o1',
  'kling-o1-reference-to-video': 'kwaivgi/kling-video-o1',
  'kling-o1-standard-image-to-video': 'kwaivgi/kling-video-o1',
  'kling-o1-standard-reference-to-video': 'kwaivgi/kling-video-o1',
  'grok-imagine-text-to-video': 'x-ai/grok-imagine-video',
  'grok-imagine-image-to-video': 'x-ai/grok-imagine-video',
  'grok-imagine-video-1-5-preview': 'x-ai/grok-imagine-video-1.5',
  'happy-horse-1-text-to-video-1080p': 'alibaba/happyhorse-1.0',
  'happy-horse-1-text-to-video-720p': 'alibaba/happyhorse-1.0',
  'happy-horse-1-image-to-video-1080p': 'alibaba/happyhorse-1.0',
  'happy-horse-1-image-to-video-720p': 'alibaba/happyhorse-1.0',
  'happy-horse-1-reference-to-video-1080p': 'alibaba/happyhorse-1.0',
  'happy-horse-1-reference-to-video-720p': 'alibaba/happyhorse-1.0',
  'happy-horse-1.1-text-to-video-1080p': 'alibaba/happyhorse-1.1',
  'happy-horse-1.1-text-to-video-720p': 'alibaba/happyhorse-1.1',
  'happy-horse-1.1-image-to-video-1080p': 'alibaba/happyhorse-1.1',
  'happy-horse-1.1-image-to-video-720p': 'alibaba/happyhorse-1.1',
  'happy-horse-1.1-reference-to-video-1080p': 'alibaba/happyhorse-1.1',
  'happy-horse-1.1-reference-to-video-720p': 'alibaba/happyhorse-1.1',
  'wan2.6-text-to-video': 'alibaba/wan-2.6',
  'wan2.6-image-to-video': 'alibaba/wan-2.6',
  'seedance-2.5-text-to-video': 'bytedance/seedance-2.5',
  'seedance-2.5-text-to-video-480p': 'bytedance/seedance-2.5',
  'seedance-2.5-image-to-video': 'bytedance/seedance-2.5',
  'seedance-2.5-image-to-video-480p': 'bytedance/seedance-2.5',
  'seedance-2.5-first-last-frame': 'bytedance/seedance-2.5',
  'seedance-2.5-first-last-frame-480p': 'bytedance/seedance-2.5',
  'seedance-2.5-omni-reference': 'bytedance/seedance-2.5',
  'seedance-2.5-omni-reference-480p': 'bytedance/seedance-2.5',
  'seedance-2-text-to-video-fast': 'bytedance/seedance-2.0-fast',
  'seedance-2-image-to-video-fast': 'bytedance/seedance-2.0-fast',
```

Then extend `OPENROUTER_MULTI_REFERENCE_MODELS` (currently `new Set(['seedance-2-mini-image-to-video'])`) to:

```js
export const OPENROUTER_MULTI_REFERENCE_MODELS = new Set([
  'seedance-2-mini-image-to-video',
  'kling-o1-reference-to-video',
  'kling-o1-standard-reference-to-video',
  'happy-horse-1-reference-to-video-1080p',
  'happy-horse-1-reference-to-video-720p',
  'happy-horse-1.1-reference-to-video-1080p',
  'happy-horse-1.1-reference-to-video-720p',
  'seedance-2.5-omni-reference',
  'seedance-2.5-omni-reference-480p',
]);
```

Do not touch `OPENROUTER_V2V_MODEL_MAP` — no entries added this pass (see rationale table above).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd nexoclip-app && node --test tests/providers/videoStudioModelFilters.test.mjs`
Expected: all 7 tests PASS, 0 failed.

- [ ] **Step 5: Commit**

```bash
cd nexoclip-app
git add packages/studio/src/models.js tests/providers/videoStudioModelFilters.test.mjs
git commit -m "feat: expand OpenRouter video model map with newly-verified models"
```

---

### Task 4: Expansion rationale doc + manual end-to-end verification

**Files:**
- Create: `docs/2026-08-27-openrouter-video-model-expansion.md`

**Interfaces:** none — documentation and manual verification only, no code.

- [ ] **Step 1: Write the rationale doc**

Create `docs/2026-08-27-openrouter-video-model-expansion.md`:

```markdown
# OpenRouter Video Model Mapping Expansion

Date: 2026-08-27
Related: `docs/superpowers/specs/2026-08-27-video-studio-openrouter-filter-design.md`,
`docs/2026-08-24-muapi-dependency-audit.md`

## Why

Filtering Video Studio's V2V picker to OpenRouter-mapped models only
(`docs/superpowers/specs/2026-08-27-video-studio-openrouter-filter-design.md`)
made the size of `OPENROUTER_V2V_MODEL_MAP`/`OPENROUTER_VIDEO_MODEL_MAP`
directly visible to users for the first time. This document records the
research done to expand those maps against OpenRouter's current
video-output catalog, and — per the same standard set by the
`seedance-2-watermark-remover` exclusion in the dependency audit — why
several name-matching candidates were deliberately left unmapped.

## Method

For each model in OpenRouter's video-output catalog (24 models, supplied
2026-08-27; the catalog listing page itself is client-rendered and not
reliably scrapable — an earlier attempt produced fabricated model names,
so this list came from the user directly, not automated fetching), the
model's individual OpenRouter documentation page
(`openrouter.ai/<publisher>/<model>`) was checked for two things:

1. A MuAPI-side counterpart id in `t2vModels`/`i2vModels`/`v2vModels`
   (`packages/studio/src/models.js`), matched by publisher + model family
   name.
2. Documented input modalities — specifically whether the model accepts
   video as an input (required for `OPENROUTER_V2V_MODEL_MAP`) versus
   text/image only (`OPENROUTER_VIDEO_MODEL_MAP`).

This is **documentation-based verification, not live API testing** — a
weaker standard than the "confirmed live" bar used for the three existing
V2V entries. Accepted tradeoff (user decision): faster/cheaper than
per-model live API calls; risk is a mapping that reads correctly in docs
but behaves unexpectedly at runtime, which would surface as a normal
`OpenRouter video request failed` error, not a silent wrong-output bug —
if that happens, the fix is removing the entry, same as any other bug.

## Mapped (added to OPENROUTER_VIDEO_MODEL_MAP)

31 new MuAPI ids across 9 OpenRouter models — see the table in
`docs/superpowers/plans/2026-08-27-video-studio-openrouter-filter.md`
(Task 3) for the full id-by-id mapping. Summary by OpenRouter model:

- `kwaivgi/kling-video-o1` — Kling O1's T2V/I2V/reference-to-video MuAPI
  ids. Doc: "supports text and image inputs with video output,
  enabling text-to-video and image-to-video workflows" — no video input.
- `x-ai/grok-imagine-video` / `x-ai/grok-imagine-video-1.5` — Grok
  Imagine's T2V/I2V ids. Doc: "accepts text and images as input" for
  both versions; the 1.5 preview MuAPI id (`grok-imagine-video-1-5-preview`)
  matches the versioned OpenRouter slug specifically rather than the base
  model.
- `alibaba/happyhorse-1.0` / `alibaba/happyhorse-1.1` — HappyHorse's T2V/
  I2V/reference-to-video MuAPI ids (both version tracks, 1080p/720p
  variants). Doc for both versions: "accepts text and images as input",
  generates "from a text prompt, a single starting image, or a set of
  reference images" — no video input for either version.
- `alibaba/wan-2.6` — base T2V/I2V ids only (`wan2.6-text-to-video`,
  `wan2.6-image-to-video`). Doc mentions "reference videos" as a
  generation source but doesn't clarify whether that's a true video input
  vs. a contextual parameter — treated as insufficient evidence for
  `OPENROUTER_V2V_MODEL_MAP`, so no V2V mapping added for this model.
- `bytedance/seedance-2.5` — T2V/I2V/first-last-frame/omni-reference ids.
  Doc confirms text, image, video, **and audio** input, explicitly
  mentions "video editing, and video extension" and "up to 50 image,
  video, and audio reference assets" — the strongest V2V signal found in
  this pass. However, no MuAPI id in `v2vModels` corresponds specifically
  to a Seedance 2.5 video-extend/edit tool (only Seedance 1.5 Pro has
  that), so this capability is captured through `seedance-2.5-omni-reference`
  (I2V + multi-reference) instead — not through `OPENROUTER_V2V_MODEL_MAP`.
  `-spicy` variants (`seedance-2.5-spicy-text-to-video`,
  `seedance-2.5-spicy-image-to-video`) were deliberately excluded — likely
  an NSFW/relaxed-content-policy mode, and OpenRouter's content policy for
  that mode wasn't confirmed, so routing it through OpenRouter risked a
  behavior change beyond just backend.
- `bytedance/seedance-2.0-fast` — base T2V/I2V ids only
  (`seedance-2-text-to-video-fast`, `seedance-2-image-to-video-fast`).
  MuAPI also has `seedance-2-vip-*-fast` and
  `seedance-2-omni-reference-no-video-fast` variants in this family;
  these were left unmapped this pass (VIP tier already serves Marketing
  Studio via a separate direct MuAPI call, and "no-video" in the id name
  suggests different capability than the base model docs describe) —
  worth a follow-up pass, not a confirmed exclusion.

## Explicitly excluded from OPENROUTER_V2V_MODEL_MAP

Every MuAPI V2V-shaped id that name-matched a new OpenRouter candidate was
checked and excluded because the model's docs describe text/image input
only:

- `kling-o1-video-edit`, `kling-o1-video-edit-fast`,
  `kling-o1-standard-video-edit` (would-be `kwaivgi/kling-video-o1`) —
  doc: "no mention of video input capability or video editing features".
- `happy-horse-1-video-edit-1080p`, `happy-horse-1-video-edit-720p`,
  `happy-horse-1.1-video-edit-1080p`, `happy-horse-1.1-video-edit-720p`
  (would-be `alibaba/happyhorse-1.0`/`1.1`) — same as the T2V/I2V doc
  finding above, no video input for either version.

`OPENROUTER_V2V_MODEL_MAP` is unchanged this pass — still exactly
`runway-aleph-v2v`, `wan2.7-video-extend`, `wan2.7-video-edit`.

## No MuAPI counterpart (nothing to map)

These OpenRouter catalog models have no matching id anywhere in
`t2vModels`/`i2vModels`/`v2vModels` today, so there's nothing to point a
map entry at:

- `alibaba/wan-3.0`
- `heygen/avatar-iv`
- `black-forest-labs/flux-video-upscale`
- `black-forest-labs/flux-3-video`
- `minimax/hailuo-3`

## Skipped pending a version-confirmed MuAPI id

- `runway/gen-4.5` — MuAPI has `runway-text-to-video`/
  `runway-image-to-video`, but nothing in either id confirms which Runway
  generation they run (Gen-3? Gen-4? Gen-4.5?). Doc confirms Gen-4.5 is
  text/image input only (no V2V), but mapping the unversioned MuAPI ids to
  a specific version risks silently changing which model version a user's
  job actually runs on. Left unmapped until a version-specific MuAPI id
  exists or this can be confirmed live.

## Open follow-ups

1. `seedance-2-vip-*-fast` and `seedance-2-omni-reference-no-video-fast`
   (part of the Seedance 2.0 Fast family) — not researched this pass, see
   note above.
2. Confirm live (not just doc-based) whether `alibaba/wan-2.6`'s
   "reference videos" generation source is a real video-input path before
   promoting it to `OPENROUTER_V2V_MODEL_MAP`.
3. `runway-text-to-video`/`runway-image-to-video` version confirmation
   (see above).
```

- [ ] **Step 2: Commit the doc**

```bash
git add docs/2026-08-27-openrouter-video-model-expansion.md
git commit -m "docs: record OpenRouter video model mapping expansion rationale"
```

- [ ] **Step 3: Manual verification — dev server**

Run: `cd nexoclip-app && npm run dev`
Wait for `Ready` in the terminal output (Next.js dev server), then open the app in a browser at the printed local URL.

- [ ] **Step 4: Manual verification — V2V dropdown is filtered**

In the browser: open Video Studio, switch to V2V mode, open the model dropdown, select the "Video Tools" (v2v) category tab.
Expected: the list shows only models whose MuAPI id is a key in `OPENROUTER_V2V_MODEL_MAP` — with this plan's changes, still just Runway Aleph and the two Wan 2.7 entries (this task added T2V/I2V mappings, not V2V ones — see Task 3 rationale). Confirm the previously-visible pure-MuAPI-only tools (e.g. "Video Watermark Remover", "AI Video Face Swap", "Kling O1 Video Edit") are **no longer in the list**.

- [ ] **Step 5: Manual verification — T2V/I2V dropdown gained new entries**

In the same dropdown, switch to "Text to Video" and "Image to Video" tabs.
Expected: new entries appear for the models added in Task 3 — e.g. search "Kling O1", "Grok Imagine", "HappyHorse", "Wan 2.6", "Seedance 2.5", "Seedance 2 Fast" and confirm each now-mapped variant is selectable.

- [ ] **Step 6: Manual verification — one new model generates end-to-end via OpenRouter**

Select "Seedance 2.5" (text-to-video variant), enter a short prompt (e.g. "a cat walking on a beach"), submit.
Expected: job completes and returns a video URL. Open browser devtools Network tab during submission and confirm the request goes to `/api/openrouter/videos` (not `/api/v1/seedance-2.5-text-to-video` or any `api.muapi.ai` path) — this confirms the OpenRouter path was actually taken, not a silent MuAPI fallback.

- [ ] **Step 7: Manual verification — legacy V2V history still renders**

If a workspace has existing V2V job history for a model that is not in `OPENROUTER_V2V_MODEL_MAP` (e.g. an old "AI Video Face Swap" job) — open Video Studio's history panel and confirm that entry still displays its thumbnail and model name correctly, even though that model is no longer selectable from the picker. (If no such history exists in the test workspace, run one V2V job on a pure-MuAPI model first via direct URL/state manipulation is not necessary — this step can be skipped with a note if no fixture history is available; do not fabricate history data solely to test this.)

- [ ] **Step 8: Stop the dev server**

Stop the process started in Step 3 (Ctrl+C in that terminal, or `kill` the process if run in background).
