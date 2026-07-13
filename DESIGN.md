---
name: B2B MarTech Intel
description: A quiet intelligence workbench — morning-scan news, AI briefings, and enablement content with Linear-grade composure.
colors:
  midnight: "#0D1846"
  working-sky: "#0063CC"
  sky-bright: "#4CA3FF"
  sunset-ember: "#C04B0C"
  ink: "#040816"
  canvas: "#FCFCFE"
  card-white: "#FFFFFF"
  mist: "#F3F4F7"
  border-hairline: "#E2E4E9"
  slate-text: "#5A6172"
  destructive: "#C52020"
typography:
  title:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.011em"
  headline:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.011em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "-0.011em"
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "-0.011em"
  data:
    fontFamily: "JetBrains Mono, Fira Code, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0"
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
spacing:
  unit: "4px"
  control-x: "16px"
  control-y: "8px"
  card: "24px"
components:
  button-primary:
    backgroundColor: "{colors.working-sky}"
    textColor: "{colors.card-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  badge-outline:
    backgroundColor: "transparent"
    textColor: "{colors.slate-text}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "36px"
---

# Design System: B2B MarTech Intel

## 1. Overview

**Creative North Star: "The Quiet Briefing Room"**

The interface behaves like a briefer who did the work before you arrived: conclusions first, evidence on request, voice low. AI output gets the room's best typography because the briefing IS the product; chrome recedes to near-silence. Midnight frames the room, Working Sky points at decisions, Sunset Ember marks what's happening right now.

The system is **dense but composed**. Density is a permission, not a failure: headlines, tags, sources, and timestamps pack tight because the reader is fluent and returns every morning. What keeps density from becoming clutter is discipline — one type family, a fixed rem scale, a 4px spacing grid, and color that only ever means something. This system explicitly rejects the anti-references named in PRODUCT.md: generic AI-SaaS dashboard slop (gradient text, glassmorphism cards, hero-metric tiles, identical icon-card grids), cluttered "everything-visible" admin panels, and prototype tells (default shadcn gray-on-gray with no hierarchy, unstyled empty states, spinner-only loading, toast spam).

Both themes are first-class. The light theme is a cool near-white workroom; the dark theme is Midnight's own house. The sidebar wears Midnight in **both** — it is the constant frame around a surface that adapts.

**Key Characteristics:**
- Conclusions-first hierarchy: every screen leads with what changed, controls wait at the edges
- One working accent (Working Sky) for actions and selection; one live accent (Sunset Ember) for AI/live activity
- Flat at rest, tinted on touch: interaction depth via overlay tints, not shadow lifts
- Dense tables and filter rows held together by alignment and rhythm, not boxes
- AI-generated prose (briefs, reports) receives the best typography in the app

## 2. Colors

A restrained cool-neutral surface framed by one deep brand anchor, with two meaningful accents. Canonical values are the HSL triples in `client/src/index.css` (light `:root` / `.dark` blocks); hexes here are the light-theme sRGB equivalents.

### Primary
- **Working Sky** (#0063CC, `--primary`, hsl(211 100% 40%)): Demandbase Sky's hue, deliberately darkened until white text holds ≥4.5:1. Primary buttons, links, current selection, focus rings. In dark mode primary returns to true **Sky Bright** (#4CA3FF) with Midnight-ink text.

### Secondary
- **Sunset Ember** (#C04B0C, `--sunset`, hsl(21 88% 40%)): the Demandbase Sunset hue held to AA on white. Marks live/AI activity — streaming indicators, "new since last visit," AI-suggestion highlights. Never decoration.

### Tertiary
- **Demandbase Midnight** (#0D1846, `--sidebar`, hsl(228 69% 16%)): the brand's deep navy. The sidebar wears it in both themes; dark mode's entire surface family is Midnight-hued (`hsl(228 …)`) so the app feels like one material at night.

### Neutral
- **Ink** (#040816, `--foreground`): body text; a navy-black, not gray. Contrast against Canvas ≈ 19:1.
- **Canvas** (#FCFCFE, `--background`): the app surface — cool near-white, chroma tinted toward Midnight's hue (228), never warm.
- **Card White** (#FFFFFF, `--card`): content containers sit one step brighter than Canvas.
- **Mist** (#F3F4F7, `--muted` / `--secondary`): quiet fills — secondary buttons, table stripes, skeletons.
- **Border Hairline** (#E2E4E9, `--border`): 1px separations; card borders one step lighter (#EDEEF2, `--card-border`).
- **Slate Text** (#5A6172, `--muted-foreground`): metadata and labels; 4.6:1 on Canvas — the darkest "muted" allowed.
- **Destructive** (#C52020, `--destructive`): errors and irreversible actions only.
- **Chart palette** (`--chart-1..5`): blue, green, violet, orange, rose — data visualization only, never UI chrome.

### Named Rules
**The One Working Color Rule.** Working Sky appears only where the user can act or has selected: primary buttons, links, active states, focus rings. If a screen is more than ~10% Working Sky, hierarchy has failed.

**The Ember Budget Rule.** Sunset Ember is reserved for liveness — AI generating, new data, suggested actions. It is prohibited as decoration, heading color, or "warmth."

**The Midnight Frame Rule.** The sidebar is Midnight in both themes. New surfaces never restyle the frame.

**The Paired Token Rule.** Every color exists as an HSL triple in both `:root` and `.dark`. A token added to one theme without the other is a defect, not a TODO.

## 3. Typography

**UI Font:** Inter (self-hosted; system-ui fallback)
**Data/Mono Font:** JetBrains Mono (Fira Code, monospace fallback)
**Prose:** Inter via `@tailwindcss/typography` for AI-generated markdown

**Character:** One family, tuned. Inter at −0.011em tracking carries everything from page titles to table cells; JetBrains Mono marks machine data (timestamps, counts, IDs). No display font — authority comes from restraint.

### Hierarchy
- **Title** (600, 1.5rem, lh 1.25): one per page, in the page header. Fixed rem — never clamp/fluid in product UI.
- **Headline** (600, 1.125rem, lh 1.35): card and section titles, dialog headers.
- **Body** (400, 0.875rem, lh 1.55): the app's default text size; the UI is a 14px world. Prose (briefs, reports) may rise to 1rem inside markdown containers, capped at 65–75ch.
- **Label** (500, 0.75rem, lh 1.35): form labels, filter names, badge text. Sentence case — never uppercase-tracked eyebrows.
- **Data** (mono 400, 0.75rem): timestamps, counts ("seen 14×"), IDs, code.

### Named Rules
**The One Scale Rule.** The five roles above are the whole scale. A new size requires deleting an old one.

**The Best Seat Rule.** AI output (Morning Brief, deep reports, analyses) gets the most careful typography in the app: real markdown rendering, 65–75ch measure, generous line-height. If generated prose looks worse than chrome, priorities are inverted.

## 4. Elevation

**Flat at rest, tinted on touch.** Surfaces are flat by default and depth is a response to interaction: the `hover-elevate` / `active-elevate-2` utilities overlay a translucent tint (`--elevate-1` ≈ 3%, `--elevate-2` ≈ 8% of the counter-color) on the element itself — no translation, no scale, no shadow growth. True shadows are reserved for things genuinely floating above the page.

### Shadow Vocabulary
- **Resting hairline** (`--shadow-xs`: 0 1px 2px rgb(0 0 0 / 0.05)): outline buttons and inputs; disappears on press (`active:shadow-none`).
- **Floating layer** (`--shadow-md`: 0 4px 6px −1px rgb(0 0 0 / 0.07)…): dropdowns, popovers.
- **Modal layer** (`--shadow-lg` / `--shadow-xl`): dialogs, command palette.
- Dark mode deepens opacities (0.2–0.5) because tint overlays read weaker on dark.

### Named Rules
**The Overlay Rule.** Interaction feedback is a tint overlay, never movement. Nothing in this app lifts, bounces, or grows on hover.

**The Earned Shadow Rule.** If it doesn't float over other content, it doesn't cast a shadow. Cards use `--card-border`, not elevation.

## 5. Components

Dense but composed: controls share one vocabulary (36px min-height rhythm, 6px radius, hairline borders), recede at rest, and answer touch with tint.

### Buttons
- **Shape:** gently rounded (6px, `rounded-md`); min-heights not fixed heights (default 36px, sm 32px, lg 40px) so content can never overflow.
- **Primary:** Working Sky fill, white text, computed darker border (`--primary-border`), padding 16px/8px.
- **Hover / Focus:** `hover-elevate` tint; `focus-visible:ring-1` in Working Sky. Press = `active-elevate-2`.
- **Outline:** transparent fill, `--button-outline` (10% ink) border, resting `shadow-xs` that vanishes on press. **Secondary:** Mist fill. **Ghost:** transparent with a transparent border (reserves layout for toggled borders). **Destructive:** filled #C52020, never outline.
- All disabled states: 50% opacity, pointer-events none.

### Chips / Badges
- **Style:** 4px radius, 2px/8px padding, label typography; outline variant uses `--badge-outline` (5% ink).
- **State:** status via filled variants (default = primary fill for approved/active; outline = neutral/pending; destructive = blocked). Tag chips on article cards are outline badges in Slate Text.

### Cards / Containers
- **Corner Style:** 10px (`rounded-lg`).
- **Background:** Card White over Canvas; one step, no stacking — nested cards are prohibited.
- **Shadow Strategy:** none at rest (Earned Shadow Rule); `--card-border` hairline does the separation.
- **Internal Padding:** 24px (compact list rows inside run 12px).

### Inputs / Fields
- **Style:** Card White fill, `--input` hairline (#D6D9E0), 6px radius, 36px height, body-size text.
- **Focus:** 1px Working Sky ring; no glow.
- **Placeholder:** must hold 4.5:1 — use Slate Text, not lighter grays.

### Navigation
- **Sidebar:** Midnight in both themes; items are ghost rows that tint on hover (`--sidebar-accent` fill when active) with Sky Bright reserved for the active indicator and focus ring. Collapsible to icons; sheet on mobile.
- **Tabs:** one tab system app-wide (shadcn Tabs with underline-free triggers); the active tab is filled, inactive tabs are ghost. No page invents its own tab dialect.
- **Command palette (⌘K):** modal layer shadow, same list vocabulary as menus.

### Signature: the Elevate interaction system
A pseudo-element overlay (`::after`, inheriting border-radius) tints any interactive surface on hover (3%) and press (8%) without touching layout. It is theme-aware (black tints on light, white on dark) and is the app's single interaction texture — buttons, sidebar rows, list items, toggles all speak it. New interactive components must adopt it rather than inventing hover styles.

## 6. Do's and Don'ts

### Do:
- **Do** keep body text at Ink and metadata at Slate Text (#5A6172) or darker — 4.5:1 is the floor for everything, placeholders included.
- **Do** add every new color as an HSL-triple token in **both** `:root` and `.dark` (Paired Token Rule) and consume it through the Tailwind semantic names.
- **Do** use the elevate utilities for every new interactive surface — one interaction texture app-wide.
- **Do** give every list a designed empty state that teaches ("Nothing needs review — new tags surface automatically once they prove out"), and skeletons for loading — in content shapes, not spinners.
- **Do** respect the global `prefers-reduced-motion` kill-switch; transitions stay 150–250ms, ease-out.
- **Do** keep AI-generated prose in markdown containers at 65–75ch with the app's best type (Best Seat Rule).

### Don't:
- **Don't** ship "generic AI-SaaS dashboard slop: gradient text, glassmorphism cards, hero-metric tiles, identical icon-card grids" (PRODUCT.md, verbatim).
- **Don't** build "cluttered 'everything-visible' admin panels where every page shouts equally" — conclusions first, controls at the edges.
- **Don't** ship prototype tells: "default shadcn gray-on-gray with no hierarchy, unstyled empty states, spinner-only loading, toast spam."
- **Don't** use side-stripe borders (`border-left` > 1px as colored accent), uppercase-tracked eyebrow labels, or numbered section scaffolding.
- **Don't** use Sunset Ember, chart colors, or saturated fills as decoration or on inactive states.
- **Don't** lift, scale, or bounce anything on hover — the Overlay Rule is the only interaction depth.
- **Don't** hardcode hex/hsl values in components; if it isn't a token, it doesn't ship.
- **Don't** invent a second tab style, button shape, or focus treatment — one vocabulary, eleven pages.
