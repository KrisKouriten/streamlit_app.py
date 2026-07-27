/*
 * Pure request-context helpers for the Finance Intelligence Layer: classifying
 * the user's question (CR §3.3) and validating the structured page-context
 * object a page hands in (CR §4.3). No I/O — so both Finance Buddy and AI
 * Perspective can lean on the same tested logic.
 */

export const QUESTION_TYPES = [
  "DESCRIPTIVE", "DIAGNOSTIC", "PREDICTIVE", "PRESCRIPTIVE", "OPERATIONAL", "REPORTING", "EXPLANATORY",
];

// Ordered most-specific first; first match wins. Falls back to DESCRIPTIVE
// ("what happened / what is the current position").
const PATTERNS = [
  ["REPORTING", /\b(draft|summar\w+|narrative|commentary|board pack|board narrative|ceo|coo|weekly (finance|update)|write (the|a|me) )/i],
  ["EXPLANATORY", /\b(explain|define|what does .* mean|how (is|was) .* (calculated|defined|classified)|why is this classified)/i],
  ["PRESCRIPTIVE", /\b(what should|what action|recommend|intervention|prioriti|how (do|can|would) (we|i) improve|what (can|could|would) .* improve|what should happen next|should (we|i) (take|do))/i],
  ["OPERATIONAL", /\b(overdue|awaiting|await|approv|blocked|which tasks|which pos|close (status|activit)|need my|needs action)/i],
  ["PREDICTIVE", /\b(will |likely|forecast to|run.?rate|project(ed|ion)|expected to|going to|at risk|full.?year)/i],
  ["DIAGNOSTIC", /\b(why|driver|driving|caused|cause of|behind|is (this|it) (timing|structural)|which .* (driv|caus|contribut))/i],
];

export function classifyQuestion(text = "") {
  const t = String(text);
  for (const [type, re] of PATTERNS) if (re.test(t)) return type;
  return "DESCRIPTIVE";
}

// Validate + normalise a page-context object. We accept only a controlled shape
// — never raw HTML or unrestricted browser state. Returns { ok, context } or
// { ok:false, error }.
export function validatePageContext(ctx) {
  if (!ctx || typeof ctx !== "object") return { ok: false, error: "Missing page context." };
  if (!ctx.pageId || typeof ctx.pageId !== "string") return { ok: false, error: "Page context needs a pageId." };
  const filters = ctx.filters && typeof ctx.filters === "object" ? ctx.filters : {};
  return {
    ok: true,
    context: {
      pageId: ctx.pageId,
      route: typeof ctx.route === "string" ? ctx.route : null,
      // A controlled, allow-listed filter bag — everything else is dropped.
      filters: pickFilters(filters),
      selectedRecord: ctx.selectedRecord == null ? null : String(ctx.selectedRecord).slice(0, 120),
      comparisonBasis: typeof ctx.comparisonBasis === "string" ? ctx.comparisonBasis : null,
    },
  };
}

const FILTER_KEYS = ["financialYear", "year", "period", "month", "entity", "region", "store", "scenario", "compare", "tab", "unit"];

function pickFilters(filters) {
  const out = {};
  for (const k of FILTER_KEYS) {
    if (filters[k] != null && filters[k] !== "") out[k] = String(filters[k]).slice(0, 60);
  }
  return out;
}
