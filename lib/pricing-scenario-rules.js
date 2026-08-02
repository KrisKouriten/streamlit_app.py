/*
 * Pricing Scenario — pure rules. No imports, no DB. Models a proposed pricing
 * change (promotion / markdown / clearance / permanent / multi-buy / premium)
 * before implementation, at SKU level, and rolls it up to a BLENDED margin
 * weighted by sales VALUE (never a simple average). Unit-tested in
 * tests/pricing-scenario-rules.test.mjs.
 *
 * A scenario never overwrites live pricing — these functions only compute the
 * pre/post impact for a version-controlled scenario.
 */

export const SCENARIO_TYPES = [
  { code: "PROMOTION", label: "Promotional pricing" },
  { code: "MARKDOWN", label: "Temporary markdown" },
  { code: "PERMANENT", label: "Permanent price change" },
  { code: "CLEARANCE", label: "Clearance pricing" },
  { code: "MULTI_BUY", label: "Multi-buy campaign" },
  { code: "PREMIUM", label: "Premium price" },
];
export const isScenarioType = (c) => SCENARIO_TYPES.some((t) => t.code === c);

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const num = (v) => Number(v) || 0;

// Margin at a selling price incl VAT, against a total cost.
function marginAt(rrpInclVat, vat, totalCost) {
  const exVat = num(rrpInclVat) / (1 + num(vat));
  const gp = exVat - num(totalCost);
  const gpPct = exVat > 0 ? gp / exVat : null;
  return { exVat: r2(exVat), gp: r2(gp), gpPct: gpPct == null ? null : r4(gpPct) };
}

// One scenario line: current vs new margin, and the margin reduction (in points).
export function scenarioLine({ currentRrp, newRrp, vat = 0.2, totalCost = 0 } = {}) {
  const current = marginAt(currentRrp, vat, totalCost);
  const proposed = marginAt(newRrp, vat, totalCost);
  const marginReductionPts = current.gpPct != null && proposed.gpPct != null ? r4(current.gpPct - proposed.gpPct) : null;
  return { current, proposed, marginReductionPts };
}

// A SKU's share of company / category / promotion sales.
export function pctOfSales({ skuSales, companySales, categorySales, promotionSales } = {}) {
  const s = num(skuSales);
  return {
    companyPct: num(companySales) > 0 ? r4(s / num(companySales)) : null,
    categoryPct: num(categorySales) > 0 ? r4(s / num(categorySales)) : null,
    promotionPct: num(promotionSales) > 0 ? r4(s / num(promotionSales)) : null,
  };
}

// The scenario's impact on COMPANY blended margin from one SKU: its company-sales
// weight × the margin movement. (Boards ask exactly this.)
export function companyMarginImpact({ companyPct, currentGpPct, newGpPct } = {}) {
  if (companyPct == null || currentGpPct == null || newGpPct == null) return null;
  return r4(num(companyPct) * (num(newGpPct) - num(currentGpPct)));
}

// Blended margin across a set of lines, weighted by SALES VALUE. Each line:
// { salesValue, scenarioSalesValue, currentGpPct, newGpPct }. Returns the current
// blended margin, the scenario blended margin and the movement (points).
export function blendedMargin(lines = []) {
  let curW = 0, curSum = 0, scnW = 0, scnSum = 0;
  for (const l of lines) {
    const cs = num(l.salesValue);
    const ss = l.scenarioSalesValue != null ? num(l.scenarioSalesValue) : cs;
    if (l.currentGpPct != null) { curW += cs; curSum += cs * num(l.currentGpPct); }
    if (l.newGpPct != null) { scnW += ss; scnSum += ss * num(l.newGpPct); }
  }
  const current = curW > 0 ? r4(curSum / curW) : null;
  const scenario = scnW > 0 ? r4(scnSum / scnW) : null;
  const movement = current != null && scenario != null ? r4(scenario - current) : null;
  return { current, scenario, movement };
}

// Commercial impact of a scenario line: revenue, gross profit, margin lost, and
// (for markdown/clearance) cash recovery + inventory reduction.
export function scenarioImpact({ currentRrp, newRrp, vat = 0.2, totalCost = 0, baselineUnits = 0, expectedUnits = 0 } = {}) {
  const line = scenarioLine({ currentRrp, newRrp, vat, totalCost });
  const baseRevenue = r2(num(baselineUnits) * line.current.exVat);
  const scnRevenue = r2(num(expectedUnits) * line.proposed.exVat);
  const baseGp = r2(num(baselineUnits) * line.current.gp);
  const scnGp = r2(num(expectedUnits) * line.proposed.gp);
  return {
    ...line,
    revenueMovement: r2(scnRevenue - baseRevenue),
    grossProfitMovement: r2(scnGp - baseGp),
    unitsMovement: r2(num(expectedUnits) - num(baselineUnits)),
    cashRecovery: r2(num(expectedUnits) * line.proposed.exVat),      // clearance cash back
    inventoryReduction: r2(num(expectedUnits)),                       // units cleared
  };
}

// Promotion ROI: incremental gross profit ÷ margin given away. > 1 means the
// extra volume more than pays for the discount.
export function promotionRoi({ incrementalGrossProfit, marginGivenAway } = {}) {
  const given = num(marginGivenAway);
  if (given <= 0) return null;
  return r4(num(incrementalGrossProfit) / given);
}
