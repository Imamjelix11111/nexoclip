# NexoClip — Remaining Pages

Quick specs for remaining pages. Apply the same global style system throughout.

---

## Listicle AI Pro

Generate "Top 5" style compilation videos automatically.

**Layout:** Two-panel — left config form, right preview

**Left panel (400px):**
- "Topik Listicle" textarea: "Top 5 Produk Viral di TikTok..."
- Jumlah Item: number stepper (3–10)
- Bahasa: select
- Gaya Visual: pill selector (Viral / Cinematic / Minimalist)
- "Generate Listicle" button (primary, full width, Sparkles icon)

**Right panel:**
- Empty state: ListOrdered icon + "Listicle kamu akan muncul di sini"
- After generation: stacked scene cards (each shows item number, title, image placeholder, script text)

---

## Thumbnail Creator

Generate eye-catching thumbnails for videos.

**Layout:** Two-column — left config (400px), right canvas preview

**Left:**
- Upload base image (dropzone, compact)
- "Teks Thumbnail" input
- Style preset pills: Bold / Clean / Dramatic / Minimal
- Background: color picker row (10 swatches)
- Font: select
- "Generate" button (primary)

**Right:**
- 16:9 canvas card (dark bg, white centered)
- Generated thumbnail preview (full width)
- "Download PNG" + "Coba Lagi" buttons below

---

## Video Insight

Analytics dashboard for individual video performance from connected social accounts.

**Layout:** Full width, padding 32px

**Top row: account selector tabs**
- Pills: TikTok @username | YouTube @username

**Metric cards (4 col):**
Views | Likes | Comments | Shares — same MetricCard style as Dashboard

**Video performance table:**
Columns: Thumbnail | Judul | Views | Likes | CTR | Tanggal

Each row: thumbnail (small 9:16 card, 48px wide) + title + stats columns + date.

---

## Performance Ads (Commerce)

Track ROI and performance of AI video ads.

**Layout:** Full width, padding 32px

**Top row: 4 metric cards**
Total Spend | Total Revenue | ROAS | Net Profit

**Main chart:**
Line chart comparing Spend vs Revenue over 30 days. Two lines: rose (spend), emerald (revenue).

**Campaign table:**
Columns: Campaign | Platform | Spend | Revenue | ROAS | Status

---

## Riset Ads (Ads Research)

Discover and analyze competitor video ad strategies.

**Layout:** Full width, 32px padding

**Search bar (prominent, top):**
Large input: "Cari produk, brand, atau kata kunci..." + "Cari" button (primary)

**Filter row:**
Platform: All | TikTok | Meta | YouTube
Sort: Engagement | Terbaru | Terlama

**Results grid (3 columns):**
Each card:
- Video thumbnail (9:16, dark)
- Brand name + platform icon
- "Est. Spend: Rp 2.5jt" badge
- Engagement stats row (views, likes, shares)
- "Analisis" button (secondary)

---

## Avatar Creator

Create custom AI video avatars.

**Layout:** Two-panel

**Left (config, 360px):**
- Upload photo (large dropzone, square with person silhouette icon)
- Nama Avatar input
- Suara: select dropdown
- Bahasa: select
- Preview button

**Right (preview):**
- Avatar video preview card (9:16)
- "Buat Avatar" button (primary, below)
- Saved avatars row at bottom: horizontal scroll of 64px avatar circles

---

## Commerce Page

Manage affiliate products and tracking links.

**Layout:** Full width, padding 32px

**Header:** "Commerce" title + "Tambah Produk" button (primary, ShoppingBag icon)

**Product grid (3 columns):**
Each card:
- Product image (square, 1:1, rounded-xl)
- Product name (13px, weight 500)
- Platform: Tokopedia / Shopee / etc. (badge)
- Clicks: "142 klik" (12px, muted)
- Tracking link: truncated URL + Copy icon
- "Lihat Detail" link (accent)

**Empty state:** ShoppingBag icon + "Belum ada produk" + "Tambah Produk" button
