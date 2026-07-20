# Phase 9 — Executive-grade redesign

A full premium pass across the platform: every screen now inherits a v2 design
system built to the standard of the best enterprise SaaS (Linear / Stripe / Arc /
Ramp references). Because all screens compose the shared token layer, the shared
kit and the shared chrome, the upgrade propagates everywhere; the marquee screens
were then polished individually.

## Design system v2 (`app/layout.js`)
- **Typography** — Inter Variable (latin, 100–900), self-hosted at
  `public/fonts/` (no external requests). Tighter display tracking, uppercase
  mono micro-labels, tabular figures (`.fos-num`) everywhere numbers align.
- **Depth** — a layered elevation system: resting/hover/pop shadows tuned per
  theme, a 1px "top light" inset on every card, and a page-top key-light
  gradient wash.
- **Texture** — a fine SVG film grain over the whole canvas (~2–3% opacity,
  pointer-transparent), theme-tuned.
- **Glass** — `--glass` tokens + `.fos-glass` (blur + saturate) used by the nav,
  the command palette, the login card and the orbit nodes.
- **Motion** — one easing (`cubic-bezier(.22,1,.36,1)`), three durations; a
  one-time page rise on navigation (`PageTransition`, re-keyed per route) and
  staggered card entrances (`.fos-stagger`). `prefers-reduced-motion` disables
  all of it.
- **Components as classes** — `.fos-card` (+`.hover` lift), `.fos-btn`,
  `.fos-btn-ghost`, `.fos-input` (focus ring), `.fos-kbd`, `.fos-tbl` row hover —
  usable from server components with zero client JS.

## ⌘K command palette (`app/command-palette.js`)
Go anywhere without the mouse: Cmd/Ctrl+K (or the nav **Search** button) opens a
glass palette over the dimmed canvas — every dashboard, control and screen,
grouped by pillar, plus actions (switch theme, sign out). Type to filter, ↑↓ to
move, ↵ to open, Esc to close. Scroll-locked, keyboard-complete, reduced-motion
aware.

## Chrome
- **Top nav** — sticky glass bar (blur + saturate), gradient-lit brand dot,
  animated active-tab underline, Search ⌘K trigger, initials avatar chip,
  refined theme toggle and sign-out.
- **Login** — the doorway is now the product: the orbital motif (rings + radial
  glow) behind a glass card, mono field labels, gradient primary button.

## Kit v2 (`app/finance-os/ui.js`)
Stat tiles on layered cards with mono labels and 27px tabular values; tables in
cards with mono uppercase headers, hairline row separators and row hover;
segmented-control SubNav; gradient-filled Bars; gradient provenance banners.
PageHeader with display-weight titles. All dashboards, hubs and GOVERN screens
inherit automatically.

## Orbital HOME
The control-tower core now casts real light (60px accent glow + inner top-light);
pillar nodes are glass chips that lift on hover.

## Verification
- `npm run build` clean; `npm test` 45/45.
- Browser-verified dark + light with screenshots (login, HOME, Dashboards hub,
  Management Accounts, Store Sales): zero page errors.
- Palette verified end-to-end: Ctrl+K → "cash" → ↵ lands on Cash Flow.
- Inter confirmed loaded via `document.fonts.check`.

No data-layer, API or migration changes in this phase — purely presentation and
interaction. (Note: running `npm run build` while `npm run dev` is serving
corrupts the shared `.next` cache — stop dev first or `rm -rf .next` after.)
