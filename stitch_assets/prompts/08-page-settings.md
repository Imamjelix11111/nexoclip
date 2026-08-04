# NexoClip — Settings Page

App configuration: server connection, appearance, language, and integrations.

---

## Layout

Two-column: left nav (260px), right content (remaining). Max-width 1000px.

```
┌──────────────────┬──────────────────────────────────┐
│  Settings Nav    │  Setting Section Content         │
│                  │                                  │
│  • Koneksi       │                                  │
│  • Tampilan      │                                  │
│  • Bahasa        │                                  │
│  • Integrasi     │                                  │
└──────────────────┴──────────────────────────────────┘
```

---

## Left Nav

- List of setting sections
- Active: accent text, accent/10 bg, radius 8px
- Each item: 13px, weight 500

---

## Setting Sections

Each section separated by horizontal border-b.

### Koneksi (Connection)
- "Backend URL" label + input field (pre-filled with server URL)
- "Auth Token" label + password input (masked)
- "Test Connection" button (secondary) → shows success (green checkmark) or error (red X) inline

### Tampilan (Appearance)
- "Tema" label + 3-option selector: System / Light / Dark
  - Each as a small card with icon, selected has accent border
- "Sidebar" toggle: show/hide labels when expanded

### Bahasa (Language)
- "Bahasa Antarmuka" label + 2-option pill toggle: "Indonesia" | "English"
- Selected pill: accent bg, white text
- Unselected: white bg, border

### Integrasi (Integrations)
- TikTok API row: logo + "Terhubung" badge or "Hubungkan" button
- YouTube row: logo + status
- Meta Ads row: logo + status

---

## Save Button

Sticky bottom bar:
- "Simpan Perubahan" button (primary, right-aligned)
- "Perubahan belum disimpan" warning text (amber, left) — only shows when dirty
