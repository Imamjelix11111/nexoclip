# NexoClip — Distribution Page

Manage social media accounts and publish videos to TikTok, YouTube, Instagram.

---

## Layout

Two columns: left sidebar (accounts), right main (queue + history)

```
┌────────────────────┬────────────────────────────────────┐
│  Social Accounts   │  Publish Queue + History           │
│  (320px)           │  (remaining)                       │
└────────────────────┴────────────────────────────────────┘
```

---

## Left Panel — Social Accounts

Card, padding 20px.

### Header
"Akun Sosial" (13px, weight 600) + "Tambah" button (small, primary, Plus icon)

### Connected Accounts List

Each account row:
```
[Platform Icon]  @username          [status]
                 TikTok · Sync 2h ago
```

- Platform icon: colored circle (TikTok=black, YouTube=red, Instagram=gradient)
- Username: 13px, weight 500, #0f172a
- Platform + last sync: 11px, #94a3b8
- Status badge: "Aktif" (emerald), "Kadaluarsa" (amber), "Error" (rose)
- Hover: show "Hapus" ghost button right side

### Empty state
Centered: Globe icon + "Belum ada akun terhubung" + "Hubungkan Akun" button (primary)

---

## Right Panel

### Tabs
`Antrian` | `Riwayat`

---

### Tab: Antrian (Queue)

**Publish Queue Table:**

Column headers: Platform | Judul | Jadwal | Status | Aksi

Each row: white card style (or table with row hover)

```
[TikTok 🎵]  Video Promosi Lebaran     Hari ini 14:00   [PENDING]    [Batalkan]
[YouTube  ▶]  Tutorial AI Editing       Besok 09:00      [SCHEDULED]  [Batalkan]
[TikTok 🎵]  Clip Viral Minggu Ini     Sekarang          [PUBLISHING] [···]
```

- Platform icon: small colored icon
- Title: 13px, truncated
- Schedule: 12px, muted
- Status badge: colored
- Action: ghost button

**Empty queue:** Send icon + "Tidak ada video dalam antrian" + "Jadwalkan Video" button

---

### Tab: Riwayat (History)

Similar table but showing published/failed posts:

```
[TikTok]  Clip Produk Terlaris    14 Mei 10:22   [PUBLISHED]  [Lihat]
[YouTube] Review App NexoClip     13 Mei 08:00   [FAILED]     [Coba Lagi]
```

- Published row: normal opacity
- Failed row: rose/5 bg tint, error icon
- "Coba Lagi" button for failed (accent, small)
