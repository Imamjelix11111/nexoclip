# NexoClip — AI UGC Agent Page

Agentic AI chat interface that generates UGC-style video ads through conversation. The most complex and premium page in the app.

---

## Layout

Full height, split horizontally:

```
┌──────────────────────┬──────────────────────────────────┐
│                      │                                  │
│   LEFT PANEL         │   RIGHT PANEL                    │
│   Chat + Input       │   Config + Preview               │
│   (flex ~420px)      │   (flex remaining)               │
│                      │                                  │
└──────────────────────┴──────────────────────────────────┘
```

---

## Left Panel — Chat Interface

Background: white, right border #e2e8f0.

### Top bar
- "AI UGC Agent" title (14px, weight 600) + Zap icon (accent)
- Small green dot "Live" status indicator (animated pulse)
- Clear/reset button (ghost, RotateCcw icon)

### Message thread (scrollable, flex-col, gap 16px, p-16px)

**AI message bubble:**
- White card, border #e2e8f0, radius 16px (top-left 4px), padding 14px 16px
- Small avatar: 28px circle, slate-100, Zap icon inside, top-left
- Text: 13px, #475569, line-height 1.6
- Can contain dividers with labels (e.g. "📋 Script generated")
- Typing indicator: 3 animated dots

**User message bubble:**
- Background #D97757/10, border #D97757/20, radius 16px (top-right 4px)
- Right-aligned
- Text: 13px, #0f172a

**System divider:**
- Full-width label centered: "─── Scene 1 of 5 ───" in 11px, muted

### Input area (sticky bottom, border-top, p-16px)
- Textarea: white bg, border #e2e8f0, radius 12px, resize none, 3 rows, 13px
- Row below: left icons (attachment, mic) + right: character count + Send button (accent bg)
- Streaming indicator: "AI sedang menulis..." with animated dots, accent color, shown while AI responds

---

## Right Panel — Configuration + Output

Background: #f8fafc, padding 24px, scrollable.

### Engine Tier Selector
Label: "ENGINE" (11px, uppercase, muted) above
3 cards in a row:

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Draft   │  │   Cut    │  │  Final   │
│ Fast gen │  │ Balanced │  │ Highest  │
│ Sora 2   │  │ Wan 2.7  │  │Seedance🔒│
└──────────┘  └──────────┘  └──────────┘
```

- Selected card: accent border 2px, accent/5 bg, accent text
- Unselected: border #e2e8f0, white bg, slate text
- Locked card: lock icon overlay in corner, opacity 60%, not clickable

### Style Presets
Label: "STYLE" above
Horizontal scrollable row of pills:
📱 UGC | 🎬 Cinematic | 🎯 Product Ad | 🗣 Testimonial | 🌟 Trending | 📰 News

Pill style: white bg, border, 12px, radius 999px. Selected: accent bg, white text.

### Avatar Selector
Label: "AVATAR" above
Horizontal scroll of 80px × 80px circular avatar cards. Last card: "+" add new.

### Generated Output
After generation completes, show:

**Video Preview Card:**
- 9:16 aspect ratio card (dark bg #0f172a), centered
- Play button overlay (white circle, 48px)
- Scene counter badge (top-left): "3 Scenes"
- Duration badge (bottom-right): "0:28"

**Storyboard Row:**
Horizontal scroll of 5 scene cards (each 9:16, smaller, ~100px wide):
- Thumbnail image
- Scene number badge (italic, top-left)
- Script preview text (10px, white, bottom overlay)

**Action buttons row:**
Download (primary) | Copy Link | Share (secondary)
