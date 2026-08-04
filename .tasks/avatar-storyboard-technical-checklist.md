# Avatar Studio vs Storyboard Scene — Technical Checklist

## Goal

Rapikan boundary antara:

1. **Avatar Studio**
   - reusable image asset
2. **Storyboard Scene Image**
   - image yang menempel ke hook / scene / CTA tertentu

---

## A. Data / Domain Contract

### A1. Shared image worker payload
**Target**
Semua image generation worker payload harus tegas punya `source`.

### Expected
```ts
source: "avatar_studio" | "storyboard_scene"
```

### Status
- ✅ sudah mulai ada

### To check
- [x] semua enqueue path utama sudah kirim `source`
- [x] worker result sekarang mengembalikan `source`
- [x] `sceneId` ikut dikirim untuk `storyboard_scene`

---

### A2. Result contract
#### Avatar Studio result
```ts
{
  type: "avatar",
  source: "avatar_studio",
  title,
  promptSnippet,
  url,
  thumbnail
}
```

#### Storyboard Scene result
```ts
{
  type: "avatar",
  source: "storyboard_scene",
  sceneId,
  url,
  thumbnail
}
```

### To check
- [x] worker result untuk `avatar_studio` konsisten
- [x] worker result untuk `storyboard_scene` konsisten
- [x] frontend normalization avatar/storyboard/video sudah jauh lebih konsisten

---

## B. Persistence Rules

### B1. Avatar Studio persistence
**Expected**
- hasil generate masuk ke library/projects
- bisa save ke folder
- reusable

### Source of truth
- `videoJob.result`
- optional `aiAvatar`

### To check
- [ ] apakah `aiAvatar` masih diperlukan atau bisa dipensiunkan
- [ ] apakah duplicate representation (`videoJob` + `aiAvatar`) masih worth it
- [x] Projects page sekarang baca avatar asset dengan source yang lebih konsisten

---

### B2. Storyboard Scene persistence
**Expected**
Begitu image selesai:
- inject `avatarImageUrl` ke item hook/scene/cta
- persist ke `CampaignSession.artifactJson`
- persist ke `StoryboardVersion.artifact`

### To check
- [x] patch artifact setelah image selesai
- [x] persist ke `artifactJson`
- [x] create version on scene image change
- [x] reload sekarang prefer active version artifact lalu fallback ke `artifactJson`
- [ ] verify no race between active version and session artifact (masih perlu observasi real usage)

---

## C. Source of Truth

### C1. Storyboard load priority
**Expected**
Saat load storyboard:
1. active version artifact
2. fallback ke `CampaignSession.artifactJson`

### To check
- [x] implement explicit load priority
- [x] jangan cuma load `artifactJson` blindly
- [x] refresh sekarang pakai version aktif kalau ada

---

### C2. Projects page asset rendering
**Expected**
Projects page harus bisa render:
- storyboard assets
- avatar assets
- videos

dengan normalisasi yang konsisten.

### To check
- [x] avatar labels
- [x] folder fetch pakai `folderId`
- [x] storyboard click redirect ke `/storyboard`
- [x] item normalization root/folder sekarang jauh lebih seragam
- [x] top-level vs nested thumbnail/title sudah dinormalisasi helper

---

## D. UI / UX Consistency

### D1. Avatar Studio
### Expected
- creation-first UX
- live job state
- result gallery
- save to folder
- open in projects

### Status
- ✅ sudah jauh lebih baik

### To check
- [ ] “use in storyboard” action
- [x] folder save confirmation UX
- [x] open in projects flow
- [ ] avatar reuse flow

---

### D2. Storyboard
### Expected
- per-scene image generation
- scene card status
- retry failed scene
- refresh-safe
- version-aware

### Status
- ✅ sebagian besar sudah

### To check
- [x] worker-based scene generation
- [x] retry UI
- [x] status badge per scene
- [x] image survives refresh flow sudah di-hardening
- [x] regenerate after refresh flow sudah di-hardening
- [ ] scene image generation must explicitly pass initial `avatarImage` + `productImage` reference into `/api/campaigns/scene-avatar`
- [ ] verify generated scene images preserve character/product identity from initial storyboard input
- [ ] upgrade scene cards from preview-first to storyboard-review-first UX
- [ ] show fuller `voiceover` + `visualPrompt` / `enrichedPrompt` in scene cards
- [ ] add detail/expand view so user can inspect full scene content without over-truncation

---

### D3. Jobs panel
### Expected
- show recent jobs
- show active jobs
- not spam polling

### Status
- ✅ basic implemented

### To check
- [x] polling reduced
- [x] click-through from job to related feature/session
- [x] job type labels / destination hints improved
- [ ] maybe group jobs by category

---

## E. Backend Stability

### E1. Polling pressure
### Expected
Only poll when needed.

### To check
- [x] header jobs only poll when open
- [x] intervals increased
- [x] major duplicate polling paths sudah dikurangi
- [ ] consider central polling manager later

---

### E2. Fly stability
### Expected
Backend not easily suspended.

### Status
- [x] `0.0.0.0` listen okay
- [x] health route exists
- [x] bumped memory to `1gb`
- [x] `min_machines_running = 1`

### To check
- [ ] observe production stability after deploy
- [ ] check Fly logs for OOM / crash / health failures
- [ ] verify startup time under real conditions

---

## F. Google / Image Provider Stability

### F1. Vision analysis
### Expected
- OpenAI Vision primary
- ChatGoogle fallback

### Status
- ✅ done

---

### F2. Image generation
### Expected
- worker-based
- retry/backoff
- less bursty

### Status
- ✅ retry/backoff added

### To check
- [ ] whether provider quota is still too aggressive in prod
- [ ] whether fallback image provider is needed
- [ ] whether avatar concurrency should be reduced further in prod

---

## G. Cleanup / Retirement

### G1. Retire old DeepUGC flow
### Status
- ✅ shell route now points `deepugc` to `AiStoryboardPage`

### To check
- [x] stale shell routing sudah diarahkan ke `AiStoryboardPage`
- [ ] remove old page/component usage if no longer needed
- [ ] decide whether to fully delete old `DeepUgcPage` or keep temporarily

---

## Suggested Priority Order

### Priority 1
**Verify storyboard refresh integrity**
- [x] active version vs artifactJson loading
- [x] scene images survive refresh (implementation hardened)
- [x] regenerate still works after refresh (implementation hardened)

### Priority 2
**Normalize Projects + Assets**
- [x] avatar/storyboard/video display normalization mostly implemented
- [x] basic folder count normalization exposed via `itemCount`
- [ ] final semantic review of folder counts vs rendered assets

### Priority 3
**Image provider resilience**
- fallback provider if Gemini image quota keeps failing in prod

### Priority 4
**Retire old DeepUGC fully**
- remove dead paths / labels / components
