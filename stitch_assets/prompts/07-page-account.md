# NexoClip — Account & Topup Page

User profile, credit balance, plan info, topup packages, and usage history.

---

## Layout

Single column, max-width 860px, padding 32px, space-y-24px.

---

## Section 1 — Profile Card

White card, radius 16px, padding 24px.

Row layout:
```
[Avatar 56px]  Imam Asyari          [Edit Profil button]
               imamasyari700@gmail.com
               Member sejak Jan 2025
```

- Avatar: 56px circle, slate-100 bg, initials text (20px, weight 600, #475569)
- Name: 16px, weight 600, #0f172a
- Email: 13px, #64748b
- Join date: 12px, #94a3b8

---

## Section 2 — Plan & Credits

White card, radius 16px, padding 24px. Two columns:

**Left — Current Plan:**
- "PAKET AKTIF" label (11px, uppercase, muted)
- Plan name: "FREE" or "PRO" (20px, weight 700, accent)
- Expiry: "Berakhir 31 Des 2025" (12px, #94a3b8) — amber if ≤7 days
- "Upgrade ke PRO" button (primary, full width)

**Right — Credits:**
- "SALDO KREDIT" label
- Balance: "1,240 BP" (20px, weight 700, #0f172a)
- "Topup Kredit" button (secondary, Coins icon)

---

## Section 3 — Topup Packages

Header: "Paket Kredit" (13px, weight 600)

**Credit package cards grid (3 columns):**

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   STARTER    │  │  POPULAR ⭐  │  │    POWER     │
│              │  │              │  │              │
│   100 BP     │  │   500 BP     │  │  1,200 BP    │
│              │  │              │  │              │
│   Rp 15.000  │  │   Rp 60.000  │  │  Rp 125.000  │
│              │  │ HEMAT 20%    │  │  HEMAT 30%   │
│  [Beli]      │  │  [Beli]      │  │  [Beli]      │
└──────────────┘  └──────────────┘  └──────────────┘
```

- "POPULAR" card: accent border 2px, "POPULAR" badge (accent bg, white text) top-center
- Price: 18px, weight 700, #0f172a
- Discount badge: emerald-50 bg, emerald-600 text
- Buy button: primary style

---

## Section 4 — Redeem Voucher

White card, small, row layout:
- Input: "Kode Voucher" placeholder, full width
- "Tukarkan" button (secondary)
- Success/error message below input

---

## Section 5 — Usage History

Header: "Riwayat Penggunaan" (13px, weight 600)

Table / list rows:

```
Auto Clip      Potong Video Viral      -25 BP    14 Mei 10:32
UGC Agent      Generate 3 Scenes       -40 BP    13 Mei 08:11
Topup          Paket Starter          +100 BP    12 Mei 15:00
```

- Feature icon (small, colored)
- Feature name: 12px, weight 500
- Description: 12px, muted, truncated
- Amount: 12px, tabular nums — negative red, positive emerald
- Time: 11px, muted, right-aligned
- Divider between rows
- "Muat lebih banyak" ghost button at bottom
