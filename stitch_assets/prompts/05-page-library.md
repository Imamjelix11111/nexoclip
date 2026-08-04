# NexoClip — Library Page

All generated video assets in one place. Browse, filter, manage, and distribute.

---

## Layout

Full width, padding 32px.

---

## Page Header

Row: "Library" title (20px, weight 600) + subtitle "Semua aset video kamu" (12px, muted)

Right side: "Refresh" icon button (secondary)

---

## Filter Tabs

Horizontal tab row below header, border-b:

`Semua` | `Auto Clip` | `UGC Agent` | `Listicle` | `Thumbnail` | `Video Editor`

- Active tab: accent text, accent border-b-2
- Inactive: slate-500, hover slate-900
- Count badge next to each label: small pill, slate-100, slate-600

---

## Search + Sort Bar

Row below tabs (mt-16px):
- Search input (left, width 300px): Search icon prefix, placeholder "Cari berdasarkan judul..."
- Sort dropdown (right): "Terbaru" / "Terlama" / "Nama"
- "Pilih Semua" checkbox (right, appears when items loaded)

---

## Asset Grid (3 columns, gap 16px)

Each asset card: white, radius 16px, shadow-sm, overflow hidden

```
┌─────────────────────────────────┐
│                                 │
│   [Video Thumbnail - dark bg]   │  ← 9:16 ratio
│   [▶ Play overlay]              │
│   [Type badge top-left]         │
│   [Expiry badge top-right] ●    │
│                                 │
├─────────────────────────────────┤
│ Title truncated to 2 lines      │
│                                 │
│ autoclip  ·  14 Mei 2025        │
│                                 │
│ [Share] [Download]  [···]       │
└─────────────────────────────────┘
```

- Thumbnail: #0f172a bg, play button (white circle 36px) centered
- Type badge: top-left overlay — "AUTO CLIP" in 10px uppercase pill, white/80 bg
- Expiry badge: top-right — "6 hari tersisa" in amber if ≤7 days, red if expired
- Title: 13px, weight 500, #0f172a, 2-line clamp
- Metadata row: 11px, #94a3b8
- Action buttons: Share (icon), Download (icon), More options (···) — appear on hover

### Expired card state
- Thumbnail desaturated (grayscale filter)
- "EXPIRED" badge red overlay
- "File tidak tersedia" text
- Only "Perpanjang" button shown

---

## Bulk Actions Bar (appears when items selected)

Sticky bottom bar that slides up when ≥1 item selected:
- "3 dipilih" count
- "Unduh Semua" button (primary)
- "Hapus" button (rose, destructive)
- "Batal" link
