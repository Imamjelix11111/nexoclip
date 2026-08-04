# NexoClip — App Shell Layout

Design the persistent shell layout of the NexoClip web app. This wraps all pages.

---

## Overall Structure

```
┌─────────────┬────────────────────────────────────────┐
│             │  Top Header Bar (sticky, 64px)          │
│   Sidebar   ├────────────────────────────────────────┤
│  (220px or  │                                         │
│   60px      │   Main Content Area                     │
│  collapsed) │   (scrollable, bg #f8fafc)              │
│             │                                         │
└─────────────┴────────────────────────────────────────┘
```

---

## Sidebar

- **Width**: 220px expanded, 60px collapsed (smooth 300ms transition)
- **Background**: white
- **Right border**: 1px solid #e2e8f0
- **Shadow**: subtle right shadow
- **Position**: sticky, full screen height, overflow hidden

### Top logo area (height 56px)
- Expanded: "NexoClip" wordmark (14px, bold, #0f172a) + collapse toggle button (chevron-left icon) aligned right
- Collapsed: only the toggle button centered (chevron-right icon)
- Bottom border: 1px #f1f5f9

### Navigation
Grouped sections with small uppercase labels between them:

**OVERVIEW**
- Dashboard (Layers icon)

**CONTENT**
- AI UGC Agent (Zap icon)
- Avatar Creator (User icon)
- Auto Clip (Scissors icon)
- Listicle AI Pro (ListOrdered icon)
- Thumbnail Creator (Image icon)
- Video Editor (Clapperboard icon)
- Video Insight (BarChart2 icon)
- Library (Library icon)

**DISTRIBUTION**
- Distribution (Send icon)

**COMMERCE**
- Commerce (ShoppingBag icon)
- Riset Ads (Search icon)
- Performance Ads (Target icon)

**SYSTEM**
- Account & Topup (User icon)
- Settings (Settings icon)

### Nav Item Style
- Expanded: icon (16px) + label (12px, weight 500) side by side, px-3 py-2, radius 8px
- Collapsed: only icon centered, tooltip on hover showing label
- **Active state**: background #D97757/10, text #D97757, left border 2px solid #D97757
- **Inactive state**: text #64748b, icon #94a3b8
- **Hover**: background #f8fafc, text #0f172a
- Section title labels: 10px, uppercase, letter-spacing 0.1em, #94a3b8, px-3 mt-4 mb-1, hidden when collapsed

### Bottom area (above logout)
- Small row: user avatar circle (28px, initials or photo) + plan badge (FREE/PRO) — visible when expanded
- Logout button (LogOut icon, small, ghost style)

---

## Top Header Bar

- **Height**: 64px
- **Background**: white with 80% opacity + backdrop blur
- **Bottom border**: 1px solid #f1f5f9
- **Shadow**: very subtle bottom shadow
- **Position**: sticky top-0, z-index 120

### Left side
- Current page name (14px, weight 600, #0f172a)

### Right side (flex row, gap 12px, items-center)
1. **Credit balance chip**: pill shape, slate-100 bg, "⚡ 1,240 BP" (12px, weight 600, #475569), border slate-200
2. **Language toggle**: small button "ID / EN", ghost style
3. **Settings icon button**: 40px circle, white bg, border, Settings icon
4. **User avatar**: 40px circle, white bg, border, user initials or photo

---

## Main Content Area

- **Background**: #f8fafc
- **Padding**: 0 (pages handle their own padding)
- **Overflow-y**: auto (scrollable)
- **Flex-grow**: 1
