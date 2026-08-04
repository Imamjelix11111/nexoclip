# TODO: Migrate Storyboard Generation to Full Worker-Based Flow

## Goal

Ubah flow utama **AI Storyboard generation** dari:
- API route + SSE direct execution

to:
- **full worker-based job processing**
- frontend cukup create job + poll progress/status

Artinya tidak ada lagi `streamDeepUGCPipeline()` sebagai jalur utama untuk production UX.

---

## Current State (Hybrid)

### Sekarang
| Flow | Execution model |
|---|---|
| Storyboard generation (script-gen → enrich-scenes → finalizer) | API route + SSE |
| Storyboard scene image generation | Worker |
| Avatar Studio generation | Worker |

### Problem current hybrid flow
- Refresh di tengah proses rawan state mismatch
- API process tetap berat karena pipeline dijalankan inline
- Log/storyboard main flow tidak konsisten dengan image flow
- Harder to recover from tab close / network drop
- Frontend harus maintain lebih banyak streaming state

---

## Target Architecture

### New flow
```txt
Frontend
→ POST /api/campaigns/launch
→ create videoJob (type=deep_ugc)
→ enqueue campaign worker
→ worker runs full pipeline
→ worker updates progress/result/version
→ frontend polls /api/jobs/:id/status
→ frontend reloads active storyboard session
```

### Result
- Storyboard generation jadi konsisten dengan avatar/image generation
- Refresh safe by default
- API lebih ringan
- Worker jadi single execution engine

---

## Scope

## 1. Backend API

### New endpoint
- [ ] Buat endpoint baru, misalnya:
```txt
POST /api/campaigns/launch
```

### Responsibility endpoint
- [ ] validasi request
- [ ] create / update `CampaignSession`
- [ ] create `VideoJob` dengan type `deep_ugc`
- [ ] enqueue ke `QUEUE_NAMES.CAMPAIGN`
- [ ] return:
```json
{ "success": true, "jobId": "...", "sessionId": "..." }
```

### Notes
- [ ] jangan lagi execute pipeline langsung di request
- [ ] jangan lagi stream SSE untuk main storyboard generation

---

## 2. Campaign Worker

### Existing file
- `backend/src/workers/processors/campaign.bullmq.ts`

### Worker responsibilities
- [ ] jalankan full `runDeepUGCPipeline(...)`
- [ ] update `videoJob.progress`
- [ ] update `videoJob.progressPercent`
- [ ] persist final `artifact`
- [ ] save storyboard version
- [ ] update `CampaignSession.status`

### Improvement needed
- [ ] worker should update progress in meaningful stages:
  - `Writing script`
  - `Enriching scenes`
  - `Finalizing storyboard`
- [ ] final result should include:
```json
{
  "artifact": { ... },
  "resultContent": "...",
  "lastNode": "finalizer"
}
```

---

## 3. Pipeline

### Existing files
- `backend/src/ai/pipelines/deep-ugc.pipeline.ts`

### Tasks
- [ ] make `runDeepUGCPipeline()` the canonical production path
- [ ] keep `streamDeepUGCPipeline()` only if still needed for debugging/dev, otherwise deprecate
- [ ] ensure pipeline can emit progress callbacks (optional helper) for worker progress updates

---

## 4. Frontend AI Storyboard

### Existing file
- `web/src/components/pages/storyboard/AiStoryboardPage.tsx`

### Replace current flow
Current:
- [ ] remove dependence on `/api/campaigns/chat/launch` SSE for main generation

Target:
- [ ] call new `POST /api/campaigns/launch`
- [ ] save `jobId`
- [ ] set status to `generating`
- [ ] poll `/api/jobs/:id/status`
- [ ] when completed:
  - reload session
  - reload versions
  - render latest active artifact

### Frontend job states
- [ ] `queued`
- [ ] `processing`
- [ ] `completed`
- [ ] `failed`

### UI changes
- [ ] replace stream-based progressive scene arrival UX with worker-progress UX
- [ ] show progress banner / status rail
- [ ] no SSE-specific event parsing anymore

---

## 5. Refresh Recovery

### Since it will be worker-based
Recovery becomes simpler:
- [ ] persist `sessionId`
- [ ] persist `jobId`
- [ ] on refresh, poll `jobId`
- [ ] when job is done, reload storyboard session

### Remove obsolete complexity
- [ ] remove stream-specific recovery assumptions
- [ ] remove stream event handling logic from AI Storyboard page

---

## 6. Versioning

### Requirement
Every successful full storyboard generation should:
- [ ] create a new `StoryboardVersion`
- [ ] set it active
- [ ] update `CampaignSession.artifactJson`

### Note
This should happen in the worker, not in frontend.

---

## 7. Jobs Panel / Projects Integration

### After worker migration
- [ ] `deep_ugc` job in Jobs panel should open `/storyboard?session=<id>`
- [ ] Projects page should still render storyboard items as before
- [ ] job detail/result should remain inspectable

---

## 8. Retirement / Cleanup

### Deprecate old main path
- [ ] retire `/api/campaigns/chat/launch` SSE as primary path
- [ ] optionally keep for debug/dev only, clearly marked legacy
- [ ] clean frontend code that handles SSE chunks for storyboard generation

### Update docs/tasks
- [ ] update `backend/src/ai/README.md`
- [ ] update `.tasks/avatar-storyboard-technical-checklist.md`

---

## Suggested Implementation Order

### Phase 1 — Backend foundation
- [ ] create `POST /api/campaigns/launch`
- [ ] ensure campaign worker can persist full result + progress

### Phase 2 — Frontend migration
- [ ] switch AI Storyboard page from SSE to job polling
- [ ] preserve refresh recovery

### Phase 3 — Cleanup
- [ ] deprecate stream launch path
- [ ] remove dead streaming logic
- [ ] update docs/tasks

---

## Success Criteria

Storyboard generation is considered fully migrated when:
- [ ] main generate flow no longer depends on SSE
- [ ] refresh during generation is fully safe
- [ ] worker is the only execution engine for storyboard creation
- [ ] final storyboard still appears in session + versions correctly
- [ ] jobs panel and projects remain consistent
