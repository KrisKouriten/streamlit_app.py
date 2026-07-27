/*
 * Corporate Reporting Centre — AI commentary perspectives and settings (CR §10,
 * §11, §28). Pure: the controlled list of commentary perspectives, the detail /
 * tone / comparison options, and the builder for the structured report-context
 * object handed to the governed Intelligence Layer. No raw data or DB access is
 * ever put in the context — only governed facts (assembled by the service) plus
 * these controlled settings. Unit-tested in tests/reporting-rules.test.mjs.
 */

// The ten controlled commentary perspectives (CR §10). `focus` is guidance woven
// into the user message; the governance system prompt (migration 045) is shared.
export const PERSPECTIVES = {
  EXECUTIVE:            { label: "Executive", audience: "CEO, COO, Board, SLT", focus: ["material performance", "key drivers", "risks", "opportunities", "decisions", "recommended actions", "EBITDA and cash effect"] },
  FINANCE_DIRECTOR:     { label: "Finance Director", audience: "CEO, COO, Board", focus: ["revenue", "gross margin", "EBITDA", "cash", "working capital", "forecast confidence", "financial controls", "strategic trade-offs", "required interventions"] },
  FPA:                  { label: "FP&A", audience: "Finance, planning", focus: ["budget variance", "forecast variance", "previous-forecast movement", "run rate", "assumptions", "sensitivities", "scenarios", "forecast risk", "forecast accuracy"] },
  COMMERCIAL_FINANCE:   { label: "Commercial Finance", audience: "Commercial, Retail", focus: ["price", "volume", "mix", "store performance", "product", "margin", "inventory", "availability", "promotions", "commercial actions"] },
  FINANCIAL_CONTROLLER: { label: "Financial Controller", audience: "Finance, Audit", focus: ["actual result", "nominal movements", "accruals", "prepayments", "reconciliations", "close status", "data completeness", "one-off items", "control exceptions"] },
  CASH_TREASURY:        { label: "Cash and Treasury", audience: "Finance, Treasury", focus: ["cash movement", "facility headroom", "receivables", "payables", "stock commitments", "capex", "tax", "funding", "lowest cash point", "liquidity risk"] },
  OPERATIONAL:          { label: "Operational", audience: "Operations, Retail", focus: ["store execution", "staffing", "inventory availability", "projects", "purchase orders", "operational tasks", "dependencies", "delivery risks"] },
  RISK:                 { label: "Risk", audience: "Board, Finance", focus: ["downside exposure", "control failures", "data quality", "forecast weakness", "cash pressure", "customer & franchise credit", "supplier concentration", "inventory ageing", "project overspend", "compliance"] },
  OPPORTUNITY:          { label: "Opportunity", audience: "Board, Commercial", focus: ["revenue recovery", "margin", "cost reduction", "working capital", "inventory optimisation", "store interventions", "pricing", "cash acceleration", "project benefits"] },
  ACTION:               { label: "Action-oriented", audience: "All", focus: ["what needs to happen", "owner", "priority", "due date", "expected value", "required decision", "dependency", "success measure"] },
};

export const DETAIL_LEVELS = ["HEADLINE", "CONCISE", "STANDARD", "DETAILED", "TECHNICAL"];
export const TONES = ["BOARD", "EXECUTIVE", "MANAGEMENT", "OPERATIONAL", "TECHNICAL", "EXTERNAL"];
export const OUTPUT_OPTIONS = [
  "drivers", "risks", "opportunities", "recommended_actions",
  "financial_effect", "decisions_required", "data_limitations", "confidence", "source_footnotes",
];

export function isPerspective(key) {
  return Object.prototype.hasOwnProperty.call(PERSPECTIVES, key);
}

export function perspectiveLabel(key) {
  return PERSPECTIVES[key]?.label || key;
}

// Default include-flags per detail level (fuller output at higher detail).
export function defaultIncludeFor(detailLevel = "STANDARD") {
  const base = { drivers: true, risks: true, opportunities: true, recommended_actions: true, financial_effect: true };
  if (detailLevel === "HEADLINE") return { drivers: true, risks: false, opportunities: false, recommended_actions: false, financial_effect: false };
  if (detailLevel === "CONCISE") return { drivers: true, risks: true, opportunities: false, recommended_actions: true, financial_effect: false };
  return base;
}

/*
 * Build the structured report-context object handed to the model (CR §28). This
 * is metadata + controlled settings only — the governed FACTS are assembled and
 * appended separately by the service so raw data never reaches the prompt here.
 */
export function buildReportContext({
  reportId, templateKey, reportingPeriod, dataThroughDate, audience,
  sectionKey, sectionTitle, scope = {}, comparator = "LATEST_FORECAST",
  perspective = "EXECUTIVE", detailLevel = "STANDARD", tone = "MANAGEMENT",
  include = null,
} = {}) {
  return {
    report_id: reportId != null ? String(reportId) : null,
    template: templateKey || null,
    reporting_period: reportingPeriod || null,
    data_through_date: dataThroughDate || null,
    audience: audience || null,
    section: sectionKey || null,
    page: sectionTitle || null,
    scope: {
      entities: scope.entities || [],
      stores: scope.stores || [],
      departments: scope.departments || [],
      franchises: scope.franchises || [],
    },
    comparison_basis: comparator,
    commentary_type: isPerspective(perspective) ? perspective : "EXECUTIVE",
    detail_level: DETAIL_LEVELS.includes(detailLevel) ? detailLevel : "STANDARD",
    tone: TONES.includes(tone) ? tone : "MANAGEMENT",
    include: include || defaultIncludeFor(detailLevel),
  };
}

// Render the context object into the plain-text preamble the model reads. Kept
// pure and deterministic so it is testable; the FACTS block is appended by the
// service (never here).
export function renderContextPreamble(ctx, focusHint) {
  const lines = [
    `REPORT CONTEXT:`,
    `- Template: ${ctx.template || "—"}`,
    `- Section: ${ctx.page || ctx.section || "—"}`,
    `- Reporting period: ${ctx.reporting_period || "—"} (data through ${ctx.data_through_date || "—"})`,
    `- Audience: ${ctx.audience || "—"}`,
    `- Comparison basis: ${ctx.comparison_basis}`,
    `- Perspective: ${perspectiveLabel(ctx.commentary_type)} · detail ${ctx.detail_level} · tone ${ctx.tone}`,
  ];
  if (focusHint?.length) lines.push(`- Focus on: ${focusHint.join(", ")}.`);
  const inc = Object.entries(ctx.include || {}).filter(([, v]) => v).map(([k]) => k.replace(/_/g, " "));
  if (inc.length) lines.push(`- Include where evidenced: ${inc.join(", ")}.`);
  return lines.join("\n");
}
