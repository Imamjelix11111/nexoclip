# NexoClip — Common UI Components

Reusable components used across all pages.

---

## Empty States

Every list/grid that can be empty shows:
- Icon: 40px, slate-300, centered
- Title: 13px, weight 500, #475569
- Subtitle: 12px, #94a3b8 (optional)
- CTA button (optional, primary or secondary)

Example:
```
      [Video icon]
  Belum ada video
  Mulai buat video pertamamu
     [Buat Sekarang]
```

---

## Loading Skeleton

Pulse animation, slate-100 bg, matching shape:
- Text: rounded bars (80% width, 14px height)
- Cards: full card shape
- Avatars: circle
- Metric values: 100px × 28px bar

---

## Toast Notifications (top-right)

Slide-in from top-right, auto-dismiss 4s:
- Success: emerald-50 bg, emerald-600 left border 4px, CheckCircle icon
- Error: rose-50 bg, rose-600 left border 4px, XCircle icon
- Info: blue-50 bg, blue-600 border, Info icon
- Width: 320px, radius 12px, shadow-lg, padding 12px 16px

---

## Confirmation Modal

Centered overlay (bg black/40):
Card (white, radius 20px, padding 32px, max-width 400px, shadow-xl):

```
         [Icon - 48px circle bg]
         
         Hapus Video Ini?
         
  Tindakan ini tidak dapat dibatalkan.
  Video akan dihapus secara permanen.
  
  [Batal]           [Hapus]
```

- Destructive action button: rose bg
- Cancel: secondary

---

## Dropdown Menu (···)

White card, border #e2e8f0, radius 12px, shadow-lg, padding 4px:
Each item: row, 13px, height 36px, px-12px, radius 8px, hover slate-50.
Destructive item: rose-600 text, hover rose-50 bg.
Divider between groups: 1px slate-100.

---

## Tooltip

Dark bg #0f172a, white text, 11px, weight 500, radius 8px, px-10px py-6px.
Arrow pointing to trigger.
Appears after 300ms hover delay.

---

## Status Badge

```
READY       → emerald-50 bg, emerald-600 text
PROCESSING  → #D97757/10 bg, #D97757 text + spinner icon
FAILED      → rose-50 bg, rose-600 text
PENDING     → slate-100 bg, slate-600 text
SCHEDULED   → blue-50 bg, blue-600 text
PUBLISHED   → emerald-50 bg, emerald-600 text
```

Size: 10px, uppercase, letter-spacing 0.1em, px-8px py-2px, radius 6px.

---

## Form Section Pattern

Used in settings and config forms:

```
Section Title (13px, weight 600, border-b, pb-16px)

Label (12px, weight 500, #475569)
[Input field]
Helper text (11px, #94a3b8)

Label
[Input field]
```

---

## Progress Bar

Height: 4px, radius full.
Track: slate-100.
Fill: #D97757 (default), emerald (success), rose (error).
Animated smooth fill transition.

---

## Step Wizard Indicator

Horizontal, centered:

```
  ●  ──────────  ●  ──────────  ○
  1   Input       2  Processing   3  Results
```

- Completed: filled emerald circle + checkmark
- Active: filled accent circle + accent label
- Upcoming: empty slate-200 circle + slate-400 label
- Line: slate-200, 1px, flex-1 between circles

---

## File Upload Dropzone

Card with dashed border-2 #e2e8f0, radius 16px, padding 32px, text-center.
Drag-over state: accent dashed border, accent/5 bg.
Has-file state: solid border, file info row (icon + name + size + remove X).
