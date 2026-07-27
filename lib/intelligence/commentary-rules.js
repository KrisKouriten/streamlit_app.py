/*
 * Pure helpers for drafted commentary (no I/O), shared by the service and UI.
 */

// Commentary subjects → the governed retrieval domains each draws on. Domains
// must be real retrieval domains (retrieval.js DOMAIN_FETCHERS / BUDDY_DOMAINS).
export const COMMENTARY_SUBJECTS = {
  MANAGEMENT_ACCOUNTS: { label: "Management accounts", domains: ["management_accounts", "finance_snapshot"] },
  CASH: { label: "Cash flow", domains: ["cash", "finance_snapshot"] },
  TRADING: { label: "Trading & stores", domains: ["store_performance", "finance_snapshot"] },
  BOARD: { label: "Board pack", domains: ["finance_snapshot", "management_accounts", "cash", "store_performance", "inventory"] },
};

export function isCommentarySubject(subject) {
  return Object.prototype.hasOwnProperty.call(COMMENTARY_SUBJECTS, subject);
}

export function domainsForSubject(subject) {
  return COMMENTARY_SUBJECTS[subject]?.domains || [];
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Deterministic UK-formatted default title, e.g. "Management accounts commentary — Jul 2026".
export function deriveCommentaryTitle(subject, date = new Date()) {
  const label = COMMENTARY_SUBJECTS[subject]?.label || "Finance";
  const d = new Date(date);
  return `${label} commentary — ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
