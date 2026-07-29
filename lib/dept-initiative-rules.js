/*
 * Departmental Budgets — operational planning (Phase 2), pure rules. No imports,
 * no DB. An initiative (campaign / project / contract) carries cost items; each
 * cost item is phased across the year by a method, and all cost items aggregate
 * into the financial grid lines. The commercial view (incremental sales, margin,
 * investment, contribution) also lives here. Unit-tested in
 * tests/dept-initiative-rules.test.mjs.
 */

export const MONTH_KEYS = ["m01", "m02", "m03", "m04", "m05", "m06", "m07", "m08", "m09", "m10", "m11", "m12"];

// The operational unit each department plans around (a template, not a hard rule).
export const DEPT_KIND = {
  Marketing: "CAMPAIGN", "Architecture & Build": "PROJECT", Logistics: "CONTRACT",
  Finance: "PROGRAMME", HR: "PROGRAMME", Merchandising: "INITIATIVE", Operations: "INITIATIVE",
};
export const KINDS = ["CAMPAIGN", "PROJECT", "CONTRACT", "PROGRAMME", "INITIATIVE"];
export const KIND_LABEL = { CAMPAIGN: "Campaign", PROJECT: "Project", CONTRACT: "Contract", PROGRAMME: "Programme", INITIATIVE: "Initiative" };
export function defaultKindFor(department) { return DEPT_KIND[department] || "INITIATIVE"; }

export const CLASSIFICATIONS = ["COMMITTED", "BAU", "GROWTH", "STRATEGIC", "DISCRETIONARY", "CONTINGENCY"];
export const CLASSIFICATION_LABEL = {
  COMMITTED: "Committed", BAU: "Business as usual", GROWTH: "Growth investment",
  STRATEGIC: "Strategic", DISCRETIONARY: "Discretionary", CONTINGENCY: "Contingency",
};

export const PHASINGS = ["EVEN", "ONEOFF", "QUARTERLY", "MANUAL"];
export const PHASING_LABEL = { EVEN: "Even across active months", ONEOFF: "One-off month", QUARTERLY: "Quarterly", MANUAL: "Manual by month" };

// The standard objectives seeded into finance.dept_budget_objective (migration
// 059). The live list is read from the DB (users can add more); this is the
// reference / offline fallback.
export const SEED_OBJECTIVES = [
  "Increase Sales", "Increase Margin", "Increase Footfall", "Increase Conversion",
  "Increase Customer Engagement", "Increase Brand Awareness", "Increase ECOM Traffic",
  "Internal business objective", "Other",
];

/*
 * What an initiative's expected outcome means, keyed by its objective. The create
 * form and editor render a single outcome field whose label + unit come from here;
 * `kind` drives how it's captured and rolled up:
 *   money → a £ figure (Sales feeds incremental sales, Margin feeds incremental
 *           margin, so contribution = margin − investment still holds)
 *   count/rate → a number in the objective's own unit (visits, ppt, %, sessions)
 *   text → a free-text target (Internal business objective / Other / any custom
 *          objective added via "+ Add new")
 */
const OUTCOME_BY_OBJECTIVE = {
  "Increase Sales":               { key: "sales",      label: "Expected incremental sales",   unit: "£",        kind: "money" },
  "Increase Margin":              { key: "margin",     label: "Expected incremental margin",  unit: "£",        kind: "money" },
  "Increase Footfall":            { key: "footfall",   label: "Expected footfall uplift",     unit: "visits",   kind: "count" },
  "Increase Conversion":          { key: "conversion", label: "Expected conversion uplift",   unit: "ppt",      kind: "rate" },
  "Increase Customer Engagement": { key: "engagement", label: "Expected engagement uplift",   unit: "%",        kind: "rate" },
  "Increase Brand Awareness":     { key: "awareness",  label: "Expected awareness uplift",    unit: "%",        kind: "rate" },
  "Increase ECOM Traffic":        { key: "ecom",       label: "Expected ECOM traffic uplift", unit: "sessions", kind: "count" },
};
export function objectiveOutcome(objective) {
  return OUTCOME_BY_OBJECTIVE[objective] || { key: "generic", label: "Expected outcome", unit: "", kind: "text" };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n) || 0;

/*
 * The effective amount of a cost item under flexible zero-based budgeting: when a
 * line carries an activity build-up (quantity AND unit cost both given), the amount
 * is quantity × unit cost; otherwise it falls back to the entered lump-sum amount.
 * This is the single source of truth the phasing and the report both use, so a
 * driver-built line and a lump-sum line phase identically.
 */
export function costAmount(cost = {}) {
  const hasBuildUp = cost.quantity != null && cost.quantity !== "" && cost.unit_cost != null && cost.unit_cost !== "";
  return hasBuildUp ? round2(num(cost.quantity) * num(cost.unit_cost)) : round2(num(cost.amount));
}
const clampMonth = (m, d) => { const v = Math.trunc(Number(m)); return Number.isFinite(v) && v >= 1 && v <= 12 ? v : d; };

// Spread `amount` (penny-exact) across the given 1-based month numbers → 12-array.
function spreadAcross(amount, monthNums) {
  const out = Array(12).fill(0);
  const ms = [...new Set(monthNums)].filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  if (!ms.length) return out;
  const cents = Math.round(num(amount) * 100);
  const base = Math.trunc(cents / ms.length);
  let rem = cents - base * ms.length; const step = rem < 0 ? -1 : 1; rem = Math.abs(rem);
  ms.forEach((m, i) => { out[m - 1] = round2((base + (i < rem ? step : 0)) / 100); });
  return out;
}

// Phase one cost item across the 12 months, honouring the initiative's active
// month range for EVEN/QUARTERLY. Returns a 12-length array (m01…m12).
export function phaseCost(cost = {}, { startMonth = 1, endMonth = 12 } = {}) {
  const start = clampMonth(startMonth, 1), end = Math.max(start, clampMonth(endMonth, 12));
  const active = []; for (let m = start; m <= end; m++) active.push(m);
  const eff = costAmount(cost); // flexible ZBB: quantity × unit cost, else lump sum
  switch (cost.phasing) {
    case "MANUAL":
      return MONTH_KEYS.map((k) => round2(num(cost[k])));
    case "ONEOFF": {
      const m = clampMonth(cost.one_off_month, start);
      const out = Array(12).fill(0); out[m - 1] = eff; return out;
    }
    case "QUARTERLY": {
      const qEnds = [3, 6, 9, 12].filter((m) => m >= start && m <= end);
      return spreadAcross(eff, qEnds.length ? qEnds : [end]);
    }
    case "EVEN":
    default:
      return spreadAcross(eff, active);
  }
}

export function costAnnual(cost = {}, range) {
  return round2(phaseCost(cost, range).reduce((t, v) => t + v, 0));
}

/*
 * Aggregate every initiative's cost items into financial grid lines, keyed by
 * category + line label, summing the monthly phasing. Each generated line is
 * tagged source:"INITIATIVE" and carries a classification (the contributing
 * initiative's; "MIXED" if they disagree).
 */
export function generateLines(initiatives = []) {
  const map = new Map(); // key -> { category, line_label, months[12], classification }
  for (const init of initiatives) {
    const range = { startMonth: init.start_month, endMonth: init.end_month };
    for (const cost of init.costs || []) {
      const key = `${cost.category || "General"}||${cost.line_label || ""}`;
      const phased = phaseCost(cost, range);
      let row = map.get(key);
      if (!row) { row = { category: cost.category || "General", line_label: cost.line_label || "", months: Array(12).fill(0), classification: init.classification || "BAU" }; map.set(key, row); }
      else if (row.classification !== (init.classification || "BAU")) row.classification = "MIXED";
      for (let i = 0; i < 12; i++) row.months[i] = round2(row.months[i] + phased[i]);
    }
  }
  return [...map.values()].map((r) => ({
    category: r.category, line_label: r.line_label, source: "INITIATIVE", classification: r.classification,
    ...Object.fromEntries(MONTH_KEYS.map((k, i) => [k, r.months[i]])),
  }));
}

/*
 * The zero-based cost detail for the report / SLT pack: one row per cost item,
 * carrying its initiative + objective, the activity build-up (driver × quantity ×
 * unit cost → amount) and the annual phased total. This is the audit trail behind
 * every number in the budget — how each line was built from the bottom up.
 */
export function zeroBasedDetail(initiatives = []) {
  const rows = [];
  for (const init of initiatives) {
    const range = { startMonth: init.start_month, endMonth: init.end_month };
    for (const cost of init.costs || []) {
      const hasBuildUp = cost.quantity != null && cost.quantity !== "" && cost.unit_cost != null && cost.unit_cost !== "";
      rows.push({
        initiative: init.name, objective: init.objective || null,
        kind: init.kind || null, classification: init.classification || "BAU",
        category: cost.category || "General", line_label: cost.line_label || "",
        driver: cost.driver || null,
        quantity: hasBuildUp ? num(cost.quantity) : null,
        unit_cost: hasBuildUp ? num(cost.unit_cost) : null,
        basis: hasBuildUp ? "ZERO_BASED" : "LUMP_SUM",
        amount: costAmount(cost),
        phasing: cost.phasing || "EVEN",
        annual: costAnnual(cost, range),
      });
    }
  }
  return rows;
}

// Total planned investment for an initiative (sum of its phased cost items).
export function initiativeInvestment(init = {}) {
  const range = { startMonth: init.start_month, endMonth: init.end_month };
  return round2((init.costs || []).reduce((t, c) => t + costAnnual(c, range), 0));
}

// Commercial roll-up across initiatives: investment, expected incremental sales &
// margin, and contribution (incremental margin less the investment).
export function commercialSummary(initiatives = []) {
  let investment = 0, incSales = 0, incMargin = 0;
  for (const init of initiatives) {
    investment = round2(investment + initiativeInvestment(init));
    incSales = round2(incSales + num(init.incremental_sales));
    incMargin = round2(incMargin + num(init.incremental_margin));
  }
  return { investment, incrementalSales: incSales, incrementalMargin: incMargin, contribution: round2(incMargin - investment) };
}

export function validateInitiative(init = {}) {
  if (!init.name || !String(init.name).trim()) return "Give the initiative a name";
  if (init.kind && !KINDS.includes(init.kind)) return "Unknown kind";
  if (init.classification && !CLASSIFICATIONS.includes(init.classification)) return "Unknown classification";
  const s = clampMonth(init.start_month, 1), e = clampMonth(init.end_month, 12);
  if (e < s) return "End month cannot be before start month";
  return null;
}
