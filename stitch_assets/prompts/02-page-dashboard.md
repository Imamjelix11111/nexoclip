# NexoClip — Dashboard Page

The home overview screen. Shows studio-wide performance metrics, recent activity, and quick access to key tools.

---

## Layout

Single column, max-width 1400px, px-32px, py-32px, space-y-32px between sections.

---

## Section 1 — Page Header

Flex row, space-between:

**Left:**
- Greeting: "Hi, Imam" — 20px, weight 600, #0f172a
- Plan badge next to name: "FREE" or "PRO" — 10px, uppercase, accent/10 bg, accent text, border accent/20, radius 6px
- Below: "Diperbarui 2 menit lalu" — 12px, #94a3b8

**Right:**
- "Segarkan" button — secondary style, RefreshCw icon, 12px

---

## Section 2 — Quick Actions

Horizontal row of 4 pill buttons:
- UGC Agent (Zap icon)
- Auto Clip (Scissors icon)
- Listicle (ListOrdered icon)
- Distribusi (Send icon)

Style: white bg, border #e2e8f0, 12px font, radius 12px, shadow-sm. On hover: border accent/40, text accent.

---

## Section 3 — Metric Cards (4 columns)

Each card: white, radius 16px, shadow-sm, padding 20px.

```
┌─────────────────────┐
│ TOTAL VIDEO   [icon]│
│                     │
│ 48                  │
└─────────────────────┘
```

- Label: 11px, uppercase, letter-spacing 0.1em, #94a3b8 — top left
- Icon: 16px in a 32px slate-50 rounded-lg box — top right, icon color #D97757
- Value: 22px, weight 600, #0f172a, tabular nums

Cards:
1. Total Video — Video icon
2. Total Views — Eye icon
3. Credits — Coins icon — shows current credit balance number
4. Est. Revenue — TrendingUp icon — shows "$0"

---

## Section 4 — Main Grid (2/3 + 1/3)

### Left card (span 2): "Tren Engagement"
- Card, padding 24px
- Header row: title "Tren Engagement" (13px, weight 600) + "7 HARI TERAKHIR" label (11px, uppercase, muted) right-aligned
- Area chart, height 256px:
  - X axis: day labels (Mon, Tue, etc.), 11px, #94a3b8
  - Grid: horizontal dashed lines, #e2e8f0
  - Area stroke: #D97757, strokeWidth 2
  - Area fill: gradient from #D97757/15 → transparent
  - Tooltip: white bg, border #e2e8f0, soft shadow, 12px
- Empty state: centered "Belum ada data" muted text

### Right card (span 1): "AI Usage"
- Card, padding 24px
- Header: "AI Usage" + "BULAN INI" label
- List of features used, sorted by count:
  ```
  autoclip         ━━━━━━━━░░  12x
  ugc-agent        ━━━━░░░░░░   7x
  listicle         ━━░░░░░░░░   3x
  ```
  - Feature name: 12px, #475569
  - Count: 11px, #94a3b8, right
  - Progress bar: 4px height, slate-100 bg, #D97757 fill, radius full
- Total row at bottom: border-top, "TOTAL" label + total count
- Empty state: BarChart3 icon + "Belum ada penggunaan"

---

## Section 5 — Bottom Grid (1/2 + 1/2)

### Left card: "Video Terbaru"
- Header: "Video Terbaru" title + "Lihat semua →" accent link (right)
- List of 5 recent video jobs, divider between each:
  ```
  [●] autoclip  ·  Clip Pendek TikTok        14 Mei   [READY]
  [⟳] ugc       ·  Product Demo Video         13 Mei  [PROCESSING]
  [✕] listicle  ·  Top 5 Produk Viral         12 Mei   [FAILED]
  ```
  - Status dot: CheckCircle2 (emerald), XCircle (rose), Loader2 spinning (accent)
  - Job type: 11px, #94a3b8
  - Title: 12px, #475569, truncated
  - Date: right, 11px, #94a3b8
  - Status badge: 10px, uppercase, colored bg
- Empty: Video icon + "Belum ada video"

### Right card: "Antrian Publish"
- Header: "Antrian Publish" + "Kelola →" link (right)
- List of 5 queued publish jobs:
  ```
  [⟳] TikTok   ·  Video Promosi Lebaran     [PENDING]
  [✓] YouTube  ·  Tutorial AI Editing       [PUBLISHED]
  ```
  - Same row style as video jobs
- Empty: Send icon + "Tidak ada antrian"
