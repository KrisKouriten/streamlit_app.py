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
  // Phase 4 — wider module coverage.
  "procurement",
  "sku",
  "three_statement",
  "close_status",
  "intercompany",
  "scenarios",
  "business_projects",
  "pricing",
  "pricing_scenario",
  "capex",
];

// Keyword → domain signals, ordered by specificity. A question can match many;
// matches become the "related" set and the strongest becomes "primary". The
// more specific modules are listed first so they win the primary slot over the
// broad snapshot/variance signals.
const SIGNALS = [
  ["procurement", /\b(procurement|purchas\w+|supplier|purchase order|\bpo\b|payment terms|days? terms|miniso (order|supply)|local supplier)\b/i],
  ["sku", /\b(sku|product line|pareto|80.?20|80\/20|dormant|slow.?mov|newness|new (product|line)|assortment|range|best.?sell)\b/i],
  ["pricing_scenario", /\b(promotion|promo|markdown|price (change|drop|cut|reduction)|clearance|multi.?buy|pricing scenario|price scenario)\b/i],
  ["capex", /\b(capex|capital (expenditure|investment|allocation)|investment (appraisal|case|portfolio)|\birr\b|\bnpv\b|payback|roce|hurdle rate|new.?store investment)\b/i],
  ["pricing", /\b(pricing|price|rrp|retail price|wholesale price|distributor price|landed cost|freight|cost build|markup|margin (health|target)|pricing health)\b/i],
  ["intercompany", /\b(intercompany|inter-company|\bico\b|recharge|disbursement|cross.?charge|entity.?to.?entity)\b/i],
  ["close_status", /\b(month.?end|close|pre.?close|period.?end|control(s)? (status|outstanding)|sign.?off|ready to close|close status)\b/i],
  ["three_statement", /\b(balance sheet|three.?statement|3.?statement|cash flow statement|net assets|equity|reserves|indirect cash)\b/i],
  ["scenarios", /\b(scenario|sensitivit|what.?if|downside|upside|stress|flex the|forecast (model|assumption)|planning assumption)\b/i],
  ["business_projects", /\b(business projects?|project register|initiative|programme|capex project|project (budget|rag|status)|flagged (red|amber))\b/i],
  ["cash", /\b(cash|liquidit|runway|working capital|receivable|payable|debtor|creditor|overdraft|headroom)\b/i],
  ["inventory", /\b(inventory|stock|ageing stock|write.?off|obsolescen|weeks of cover|stock cover)\b/i],
  ["store_performance", /\b(store|footfall|basket|conversion|like.?for.?like|lfl|sales per|atv|units per|store kpi|retail|league|break.?even)\b/i],
  ["management_accounts", /\b(management accounts|variance|budget|actual vs|vs budget|vs forecast|overspend|underspend|cost line|opex)\b/i],
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
