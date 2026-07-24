/* Pure LLM prompt-building for agent commentary — no imports, no network,
 * unit-testable. Keeps the guardrails (use only supplied figures, no
 * fabrication, draft-for-review) in one deterministic place so they are tested
 * rather than buried in a network call. */

const GBP = (n) => `£${Math.round(Number(n) || 0).toLocaleString("en-GB")}`;
const PCT = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);

// System prompt: the model is a drafting assistant, fenced to the figures it is
// given. Named "Miniso UK" per house style; explicitly barred from inventing
// numbers or opining outside store trading.
export const COMMENTARY_SYSTEM = [
  "You are a finance analyst at Miniso UK drafting internal management commentary on company-owned store trading.",
  "Follow these rules exactly:",
  "- Use ONLY the figures provided in the user message. Never invent, estimate, or introduce any number, percentage, comparison, or external fact that is not given.",
  "- If the figures are insufficient to support a point, say so plainly rather than speculating.",
  "- Report in pounds sterling using UK conventions. Refer to the business as \"Miniso UK\".",
  "- Write 2 to 4 short paragraphs of plain prose. No bullet points, no headings, no preamble, no sign-off.",
  "- Be factual and measured. Do not give investment advice; do not opine on staffing, leases, or franchise matters.",
  "- This is a draft for human review before any use.",
].join("\n");

// Build the { system, user } messages from a figures object. Pure and
// deterministic — the figures are gathered by the runner (read-only) and passed
// in; this function never touches the database or the clock.
export function buildCommentaryPrompt(figures) {
  const f = figures || {};
  const t = f.totals || {};
  const lines = [];
  lines.push(`Reporting period: year-to-date ${f.period?.from || "?"} to ${f.period?.to || "?"} (data as at ${f.dataAsOf || f.period?.to || "?"}).`);
  lines.push(`Company-owned stores compared: ${f.comparableStores ?? "?"} (of ${f.storeCount ?? "?"} with data).`);
  lines.push(`Net sales YTD: ${GBP(t.cyNet)} versus ${GBP(t.pyNet)} the same period last year (${PCT(t.yoyPct)} year on year).`);
  if (f.footfallYoyPct != null) lines.push(`Footfall YTD year on year: ${PCT(f.footfallYoyPct)}.`);
  const fmt = (list) => (list || []).map((m) => `${m.name} ${PCT(m.yoyPct)} (${GBP(m.cyNet)})`).join("; ");
  const up = fmt(f.movers?.up);
  const down = fmt(f.movers?.down);
  if (up) lines.push(`Strongest year-on-year sales growth: ${up}.`);
  if (down) lines.push(`Weakest year-on-year sales: ${down}.`);

  const user = `Here are the store trading figures. Write the weekly trading commentary.\n\n${lines.join("\n")}`;
  return { system: COMMENTARY_SYSTEM, user };
}
