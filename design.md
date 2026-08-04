# NexoClip Design System

## Overview
NexoClip is an AI-powered video creation and distribution platform. The design philosophy is "Viral Efficiency"—high-impact, premium aesthetics paired with professional, functional simplicity.

---

## Design Tokens

### Colors
- **Primary:** `#6366f1` (Indigo) - Used for primary actions, accents, and branding highlights.
- **Background:** `#000000` (Pure Black) - The base color for all production areas.
- **Surface:** `#111111` (Deep Gray) - Used for cards, sidebars, and nested containers.
- **Border:** `rgba(255, 255, 255, 0.05)` - Subtle dividers to maintain a minimal look.
- **Success:** `#10b981` (Emerald) - For completed renders and positive statuses.
- **Danger:** `#f43f5e` (Rose) - For destructive actions like permanent deletion.

### Typography
- **Primary Font:** `Inter` - Used for body text, labels, and general UI.
- **Header Font:** `Manrope` - Used for titles and brand presence (Weights: 700-900).
- **Body Font:** `Poppins` - Alternative for marketing sections.

### Shapes & Shadows
- **Radius:** `rounded-2xl` (16px) is the standard for cards and buttons. Large preview containers use `rounded-[2.5rem]`.
- **Shadows:** Indigo glow effect for active states: `shadow-[0_0_100px_-20px_rgba(99,102,241,0.2)]`.

---

## Components

### Navigation Shell
- **Sidebar:** Width `260px`, Background `#141416`, Icons with text labels.
- **Top Bar:** Sticky, translucent background (`backdrop-blur-md`), showing breadcrumbs and credit balance.

### Grid Cards
- **Aspect Ratio:** `1.8/1` (Wide) for library previews.
- **Interaction:** `hover:scale-[1.01]` with a subtle indigo border highlight.

### Buttons
- **Primary:** Indigo background, white bold text, `rounded-2xl`.
- **Ghost:** White background with 5-10% opacity, white text.
- **Danger:** Red background with 5% opacity, red text for non-destructive triggers; solid red for final confirmation.

---

## Guidelines
1. **Full-Width Content:** Production tools (Editor, Library, DeepUGC) must utilize the maximum available screen space.
2. **Dark Mode First:** The application is built around a deep dark aesthetic. Light mode is secondary.
3. **AI feedback:** All AI-driven content should be accompanied by the `Sparkles` icon or a subtle shimmer animation to indicate "active processing".
4. **Consistency:** Never use pure white backgrounds in the production dashboard; always use the `#000000` and `#111111` surface hierarchy.
