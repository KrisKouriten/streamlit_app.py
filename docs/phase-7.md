# Phase 7 — Visual pass: "The Connected Finance Function"

Delivered 20/07/2026. Scope: give the FOS the identity from the strategy deck
(*The Connected Finance Function — 2030 by 2027*) and turn its central metaphor —
*"from six silos to one connected sphere"* — into a real place. HOME becomes the
sphere; the whole app adopts the deck's dark, olive-gold identity.

## Design system (`app/layout.js`)

- **Dark by default**, with a retained light theme via `:root[data-theme="light"]`.
  A pre-paint inline script applies a stored light preference before first paint
  (no flash); `<html suppressHydrationWarning>` covers the intentional attribute.
- **One accent — olive-gold `#5d5d23`** (sampled from the deck's eyebrow chip),
  lifted to `#c8bd6b` for emphasis on dark and deepened to `#6a6a1e` for contrast
  on light. Warm near-black grounds (`#121110`), neo-grotesque type voice.
- A shared **`.fos-eyebrow`** brand device (uppercase, letter-spaced, olive-gold).
- Every screen themes off the tokens, so the whole app re-skinned from one file.
  The 42 previously-hardcoded reds were swept to `var(--red)` / `var(--red-bg)` so
  severity colours theme correctly in both modes.
- A **theme toggle** in the top nav (dark ↔ light, persisted to `localStorage`).

## The sphere — orbital HOME (`app/finance-os/executive/orbit.js`)

HOME opens with the connected sphere: the **control-tower core** at the centre
(showing how many items need attention) with the **six pillars orbiting** it on
connective lines — each an accessible link carrying a live signal:

| Node | Live signal |
|---|---|
| PLAN | % of FY plan delivered |
| PERFORM | open tasks this week |
| OPERATE | store feed status |
| AI CONTROL TOWER | agent outputs awaiting review |
| GOVERN | open / overdue actions |
| COMMERCIAL | the deck's sixth pillar — shown as planned (2027) |

A one-time reveal draws the lines and fades the nodes in; the core has a slow
pulse. It respects `prefers-reduced-motion`, and on narrow screens collapses to a
core banner + a grid of pillar cards. Below the sphere sits the Phase-5 exception
content (position tiles, forward view, the ranked "needs attention" feed, operating
health) — all restyled to the dark identity.

## Everything else
Top nav (wordmark + gold node + active-pillar in gold + theme toggle), the login
screen (rebranded to "The Connected Finance Function", accessible gold button), the
shared UI kit and all pillar/finance pages re-theme automatically through the tokens.

## Verified
- HOME renders the orbit in **dark and light**, and collapses cleanly on a 430px
  viewport; the finance pages, login and chrome all carry the identity; no page or
  hydration issues.
- `npm test` **37/37**; production build clean.

## Design decisions & follow-ups
- **Type:** a neo-grotesque **system stack** (Helvetica Neue → Arial → system) is
  used rather than a webfont — faithful to the deck (which is Helvetica-family) and
  zero load/build risk. A licensed face (e.g. Söhne/Neue Haas) or a self-hosted
  Geist could be dropped in later for an exact match — it's a one-line token change.
- **Imagery:** the deck leans on cinematic stock photography; the app deliberately
  carries the identity through the *type, the olive-gold, and the orbit* instead,
  which travels better in a live product and avoids the generic-deck look.
- The deck names five specialised agents (Financial Controller, FP&A, Treasury,
  Commercial, Governance); the app has two today. That's the on-strategy build list
  for future agent work — the registry already supports it.
