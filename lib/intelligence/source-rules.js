/*
 * Pure helpers for source citations and claim validation (CR §7 traceability,
 * §10 "avoid invented figures"). No I/O.
 */

// Normalise a citation attached to a retrieved fact. Every material figure the
// AI cites should carry one of these back to its Finance OS source.
export function makeSource({
  module,
  service = null,
  period = null,
  entity = null,
  store = null,
  scenario = null,
  dataThrough = null,
  route = null,
  label = null,
}) {
  return {
    label: label || module,
    module,
    service,
    period,
    entity,
    store,
    scenario,
    dataThrough,
    route,
  };
}

// Round to pennies / whole for tolerant comparison.
function normaliseNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  const n = Number(String(v).replace(/[£$,%\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/*
 * Structural guard against fabricated figures: every numeric claim the model
 * made must map to a governed value we actually supplied. This is a backstop on
 * top of the prompt constraint + mandatory human review, not a replacement.
 *
 * claims: [{ value, sourceLabel? }]   facts: number[] (the governed values passed in)
 * → { ok, unverified: [...claims] }
 */
export function validateClaims(claims = [], facts = []) {
  const factSet = new Set(facts.map(normaliseNumber).filter((n) => !Number.isNaN(n)));
  const unverified = [];
  for (const c of claims) {
    if (c == null || c.value == null) continue;
    const n = normaliseNumber(c.value);
    if (Number.isNaN(n)) continue; // non-numeric prose claim — nothing to check here
    if (!factSet.has(n)) unverified.push(c);
  }
  return { ok: unverified.length === 0, unverified };
}
