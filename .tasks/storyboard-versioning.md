# TODO: Storyboard Versioning

## Overview

Setiap kali user generate atau edit storyboard, versi baru disimpan ke DB.
Semua versi berada di folder yang sama. User bisa lihat history dan restore versi lama.

---

## Problem Sekarang

- `CampaignSession.artifactJson` hanya simpan 1 versi terakhir
- Kalau regenerate → versi sebelumnya hilang permanen
- `artifactHistory` di frontend hanya in-memory → hilang saat refresh
- Tidak ada cara untuk kembali ke versi sebelumnya

---

## Solusi: Tabel `StoryboardVersion`

```
Folder (1)
  └── CampaignSession (1)
        └── StoryboardVersion (many)
              - version 1 (initial)
              - version 2 (revised hook)
              - version 3 (...)
```

---

## DB Schema

### Tambah ke `schema.prisma`

```prisma
model StoryboardVersion {
  id                String          @id @default(uuid())
  campaignSessionId String          @map("campaign_session_id")
  version           Int             // auto-increment per session: 1, 2, 3...
  label             String?         // opsional: "v1 - Initial", "v2 - Revised hook"
  artifact          Json            // full artifact JSON
  isActive          Boolean         @default(false) @map("is_active")
  createdAt         DateTime        @default(now()) @map("created_at")

  campaignSession   CampaignSession @relation(fields: [campaignSessionId], references: [id], onDelete: Cascade)

  @@unique([campaignSessionId, version])
  @@index([campaignSessionId, version])
  @@map("storyboard_versions")
}
```

### Tambah relasi ke `CampaignSession`

```prisma
storyboardVersions StoryboardVersion[]
```

---

## Flow

### Generate pertama kali
```
pipeline selesai
  → hitung version = (count existing versions) + 1   // = 1
  → INSERT StoryboardVersion { version: 1, isActive: true, artifact }
  → UPDATE CampaignSession.artifactJson = artifact   // cache
```

### Regenerate (launch ulang)
```
pipeline selesai
  → UPDATE StoryboardVersion SET isActive = false WHERE campaignSessionId = X
  → hitung version = (count existing versions) + 1   // = 2, 3, dst
  → INSERT StoryboardVersion { version: N, isActive: true, artifact }
  → UPDATE CampaignSession.artifactJson = artifact   // cache
```

### Restore versi lama
```
user pilih versi yang mau di-restore
  → UPDATE StoryboardVersion SET isActive = false WHERE campaignSessionId = X
  → UPDATE StoryboardVersion SET isActive = true WHERE id = targetId
  → UPDATE CampaignSession.artifactJson = target.artifact
  → return artifact ke frontend
```

---

## Backend Tasks

- [x] **Prisma schema** — tambah model `StoryboardVersion` + relasi di `CampaignSession`
- [x] **Migration** — `npx prisma db push` (Supabase pooler tidak support shadow DB)
- [x] **Data migration script** — `scripts/migrate-storyboard-versions.ts` — skip-safe, jalankan dengan `doppler run -- npx tsx scripts/migrate-storyboard-versions.ts`
- [x] **`campaign.routes.ts`** — tambah `POST /chat/launch` — jalankan pipeline + save `StoryboardVersion` setelah selesai
- [x] **`campaign.routes.ts`** — tambah `POST /chat/stream` — conversation agent SSE
- [x] **`campaign.routes.ts`** — tambah `GET /:id/versions` — list versi (tanpa artifact)
- [x] **`campaign.routes.ts`** — tambah `GET /:id/versions/:versionId` — get full artifact
- [x] **`campaign.routes.ts`** — tambah `POST /:id/versions/:versionId/restore` — restore versi
- [x] **`campaign.routes.ts`** — tambah `PATCH /:id/versions/:versionId` — update label
- [ ] **`campaign.routes.ts` PATCH session** — kalau user edit artifact manual (bukan via pipeline), buat versi baru

---

## Frontend Tasks

- [ ] **Version history panel** — tampilkan list versi di sidebar / panel kanan
  - Tampilkan: nomor versi, label, tanggal, badge "Active"
  - Tombol restore per versi
- [ ] **Restore confirmation** — modal konfirmasi sebelum restore (karena akan override versi aktif)
- [ ] **Version label** — auto-label format: `"v{N} · {tanggal} {jam}"`
  - Opsional: user bisa rename label (inline edit)
- [ ] **Active indicator** — highlight versi yang sedang aktif
- [ ] **Hapus `artifactHistory` in-memory state** — ganti dengan fetch dari `GET /:id/versions`
- [ ] **Auto-fetch versions** — setelah pipeline selesai, refresh version list

---

## API Contract

### `GET /api/campaigns/:id/versions`
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "version": 1,
      "label": "v1 · 8 Jun 10:30",
      "isActive": false,
      "createdAt": "2026-06-08T10:30:00Z"
    },
    {
      "id": "uuid",
      "version": 2,
      "label": "v2 · 8 Jun 14:15",
      "isActive": true,
      "createdAt": "2026-06-08T14:15:00Z"
    }
  ]
}
```

### `GET /api/campaigns/:id/versions/:versionId`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "version": 2,
    "label": "v2 · 8 Jun 14:15",
    "isActive": true,
    "artifact": { ... }, // full artifact
    "createdAt": "2026-06-08T14:15:00Z"
  }
}
```

### `POST /api/campaigns/:id/versions/:versionId/restore`
```json
// response
{
  "success": true,
  "data": {
    "restoredVersion": 1,
    "artifact": { ... }
  }
}
```

### `PATCH /api/campaigns/:id/versions/:versionId`
```json
// request
{ "label": "Hook versi lucu" }

// response
{ "success": true }
```

---

## Notes

- Artifact JSON bisa besar (hooks + scenes + ctas dengan semua prompts) — pertimbangkan limit versi max per session (misal: 20 versi) untuk hemat storage
- `CampaignSession.artifactJson` tetap ada sebagai cache — tidak perlu JOIN setiap load session
- Versioning hanya untuk storyboard (artifact) — bukan untuk settings/wizard state
- Video yang sudah di-generate dari sebuah versi tetap ada di `VideoJob` meskipun versi storyboard-nya di-restore
