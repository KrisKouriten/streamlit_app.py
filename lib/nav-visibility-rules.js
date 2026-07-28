/*
 * Per-department navigation visibility — pure rules. No imports, no DB. Shared by
 * the Access editor (Users, Roles & Permissions) and the sidebar so they agree on
 * how a nav node is keyed and when it is visible. A "hidden set" is the set of
 * node keys hidden for a department; absence = visible (default open). Hiding a
 * header hides the whole section; individual sub-headers can be hidden while the
 * header stays visible. Unit-tested in tests/nav-visibility-rules.test.mjs.
 */

// Stable id for a nav item within its section (href > slug > action > label).
export function itemId(it) {
  return it.href || it.slug || it.action || it.label;
}

export function sectionKey(sec) {
  return `sec:${sec.key}`;
}

export function itemKey(sec, it) {
  return `item:${sec.key}:${itemId(it)}`;
}

function asSet(hidden) {
  return hidden instanceof Set ? hidden : new Set(hidden || []);
}

export function isSectionVisible(sec, hidden) {
  return !asSet(hidden).has(sectionKey(sec));
}

export function isItemVisible(sec, it, hidden) {
  const h = asSet(hidden);
  return !h.has(sectionKey(sec)) && !h.has(itemKey(sec, it));
}

/*
 * Filter NAV_SECTIONS for rendering: drop hidden sections, drop hidden items, and
 * drop any section left with no visible items. Returns new section objects
 * (does not mutate the registry).
 */
export function visibleNav(sections, hidden) {
  const h = asSet(hidden);
  return sections
    .filter((s) => !h.has(sectionKey(s)))
    .map((s) => ({ ...s, items: (s.items || []).filter((it) => !h.has(itemKey(s, it))) }))
    .filter((s) => (s.items || []).length > 0);
}

/*
 * Editor helper — apply a tick toggle and return the new hidden set.
 *  - Toggling a HEADER: visible=false hides the section (add sec key); visible=true
 *    un-hides it (remove sec key) AND clears any per-item hides beneath it so the
 *    whole section reappears cleanly.
 *  - Toggling an ITEM: add/remove that item key (only meaningful when the header
 *    is visible).
 */
export function applyToggle(hidden, { kind, sec, it, visible }) {
  const h = asSet(hidden);
  const out = new Set(h);
  if (kind === "section") {
    const k = sectionKey(sec);
    if (visible) {
      out.delete(k);
      // clear item-level hides under this section
      for (const key of h) if (key.startsWith(`item:${sec.key}:`)) out.delete(key);
    } else {
      out.add(k);
    }
  } else {
    const k = itemKey(sec, it);
    if (visible) out.delete(k); else out.add(k);
  }
  return out;
}
