/*
 * Pure helpers for the proactive briefing (no I/O), so they stay unit-testable
 * and the service and any UI share one definition.
 */

// The governed domains an exec finance brief draws on. A curated cross-section
// of the retrieval layer — kept in step with retrieval.js DOMAIN_FETCHERS.
export const BRIEFING_DOMAINS = [
  "finance_snapshot",
  "management_accounts",
  "cash",
  "store_performance",
  "inventory",
];

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deterministic UK-formatted title, e.g. "Finance brief — Mon 27 Jul 2026".
// Uses UTC so it is stable regardless of server timezone (and testable).
export function deriveBriefingTitle(kind = "EXEC", date = new Date()) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `Finance brief — ${DOW[d.getUTCDay()]} ${dd} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
