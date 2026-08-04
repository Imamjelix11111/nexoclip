# NexoClip — Auto Clip Page

Upload a long video → AI automatically extracts viral short-form clips. 3-step wizard flow.

---

## Layout

Centered content, max-width 860px, padding 32px. Step indicator at top.

---

## Step Indicator (top of page)

3 steps in a horizontal row:
```
① Input  ──────  ② Processing  ──────  ③ Results
```
- Active step: accent filled circle, accent text
- Completed step: checkmark filled circle, muted text
- Upcoming step: slate-200 circle, slate-400 text
- Connecting lines between steps: slate-200

---

## Step 1 — Input

### Upload Zone
Large dashed-border card (border-2 dashed #e2e8f0), radius 16px, padding 40px, text-center:
- Upload icon (40px, #D97757/60)
- "Drag & drop video atau paste URL" — 14px, #475569
- "MP4, MOV, AVI · Maks 500MB" — 12px, #94a3b8
- "atau" divider
- "Pilih File" button (secondary)

When file selected: replace with mini preview card showing filename, size, duration, and remove X button.

### URL Input (alternative)
Below upload zone, OR-divider, then:
- Input field with Link icon prefix, placeholder "https://youtube.com/watch?v=..."
- "Gunakan URL" button (ghost, small)

### Options Panel (card, below)
Title: "Opsi Pemotongan" (13px, weight 600)
Grid 2 columns:
- Target Durasi: select dropdown (15s / 30s / 60s)
- Jumlah Clip: number input (default 5)
- Bahasa Transkripsi: select (Auto / Indonesia / English)
- AI Focus Prompt: textarea, placeholder "Fokuskan pada momen emosional..."
- Ukuran Font Subtitle: select (Small / Medium / Large)
- Face Detection: toggle switch

### CTA
Full-width "Mulai Proses →" button (primary, large), disabled if no input.

---

## Step 2 — Processing

Centered card (white, radius 16px, padding 40px, shadow):

```
        [animated spinner, 48px, accent color]
        
     AI sedang menganalisis video kamu...
     
     00:02:34 berlalu
     
     ─────────────────────────────────────────
     ✓  Transkripsi selesai
     ✓  Deteksi scene selesai
     ⟳  Memilih momen terbaik...
     ○  Mengrender klip
     ○  Finalisasi output
```

- Progress log: monospace 11px, slate-500, checkmark green / spinner accent / circle muted
- "Proses berjalan di background — kamu bisa navigasi ke halaman lain" — info banner below card

---

## Step 3 — Results

### Header row
"5 Klip Ditemukan" (18px, weight 600) + "Unduh Semua" button (primary, right)

### Clip Grid (2 columns)
Each clip card: white, radius 16px, shadow-sm

```
┌─────────────────────────────────┐
│  [9:16 video thumbnail, dark]   │
│  ▶  0:28                        │
├─────────────────────────────────┤
│  Clip #1                        │
│  "Momen paling viral di detik.."│
│  [Share] [Download] [Preview]   │
└─────────────────────────────────┘
```

- Thumbnail: dark bg, play button overlay, duration badge bottom-right
- Clip number: 11px, uppercase, muted
- Title: 13px, #475569, 2 lines max, truncated
- Action buttons row: small ghost buttons with icons
