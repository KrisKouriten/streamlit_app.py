/*
 * Pure domain selection for Finance Buddy (CR §3.4). AI Perspective is anchored
 * to a page and reads its domains from the page-relationship registry; Buddy is
 * open-ended and has no page, so it must decide which governed finance domains
 * are relevant to a free-text question. This is that decision — deterministic,
 * no I/O — so it is unit-testable and never lets the model pick its own data.
 *
 * It only ever returns domains that actually exist in the retrieval layer
 * (retrieval.js DOMAIN_FETCHERS); anything else would degrade to a limitation.
 */

// The governed domains Buddy can retrieve. Keep in step with retrieval.js.
export const BUDDY_DOMAINS = [
  "finance_snapshot",
  "management_accounts",
  "store_performance",
  "cash",
  "inventory",
];

// Keyword → domain signals, ordered by specificity. A question can match many;
// matches become the "related" set and the strongest becomes "primary".
const SIGNALS = [
  ["cash", /\b(cash|liquidit|runway|working capital|receivable|payable|debtor|creditor|overdraft|headroom)\b/i],
  ["inventory", /\b(inventory|stock|sku|dormant|slow.?mov|newness|new sku|ageing stock|write.?off|obsolescen)\b/i],
  ["store_performance", /\b(store|footfall|basket|conversion|like.?for.?like|lfl|sales per|atv|units per|store kpi|retail)\b/i],
  ["management_accounts", /\b(management accounts|variance|budget|forecast|actual vs|vs budget|vs forecast|overspend|underspend|cost line|opex)\b/i],
  ["finance_snapshot", /\b(revenue|turnover|margin|gross|ebitda|profit|p&l|net result|consolidat|top.?line|bottom.?line|performance)\b/i],
];

/*
 * Select the governed domains for a Buddy question.
 * Returns { primary: string[], related: string[] } — the same shape the
 * orchestrator already consumes from the page registry.
 *
 * Rules:
 *  - Every matched domain is included (deduped, in BUDDY_DOMAINS order).
 *  - The first (most specific) match is the primary domain.
 *  - A question with no recognisable signal falls back to finance_snapshot —
 *    the consolidated position — so Buddy always has a governed anchor rather
 *    than guessing.
 */
export function selectDomains(question = "") {
  const t = String(question || "");
  const matched = [];
  for (const [domain, re] of SIGNALS) {
    if (re.test(t) && !matched.includes(domain)) matched.push(domain);
  }

  if (!matched.length) {
    return { primary: ["finance_snapshot"], related: [] };
  }

  // Preserve a stable retrieval order (BUDDY_DOMAINS) for the related set, but
  // keep the most specific match as primary.
  const primary = matched[0];
  const related = BUDDY_DOMAINS.filter((d) => matched.includes(d) && d !== primary);
  return { primary: [primary], related };
}
