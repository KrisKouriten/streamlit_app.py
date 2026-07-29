/*
 * Driver-based planning engine — pure rules (Phase 1 foundation). No imports, no
 * DB. Shared by the planning DB layer and (later) the calculation engine so they
 * agree on the controlled vocabulary and, crucially, on ASSUMPTION RESOLUTION:
 * which value applies to a given store/period/scenario when assumptions are set
 * at several levels (company → region → entity → store). Unit-tested in
 * tests/planning-rules.test.mjs.
 *
 * Design principle: the planning engine owns calculations; the Chart of Accounts
 * owns classification; the P&L template owns presentation. This file is the
 * calculation layer's vocabulary + the assumption-precedence rule.
 */

// ---- Controlled vocabulary ---------------------------------------------

export const PLANNING_SCOPES = ["COMPANY_STORE", "HEAD_OFFICE", "FRANCHISE_STORE", "CONSOLIDATION_ADJUSTMENT"];
export const DRIVER_CATEGORIES = ["SALES", "COST", "PAYROLL", "FRANCHISE"];
export const DRIVER_APPROVAL = ["DRAFT", "APPROVED", "RETIRED"];
export const ASSUMPTION_APPROVAL = ["DRAFT", "APPROVED"];

// Assumption levels, least → most specific. The most specific APPROVED value wins.
export const ASSUMPTION_LEVELS = ["COMPANY", "REGION", "ENTITY", "STORE"];
export const LEVEL_SPECIFICITY = { COMPANY: 1, REGION: 2, ENTITY: 3, STORE: 4 };

// Sales calculation methods (how a store's sales forecast is produced).
export const SALES_METHODS = ["CORE", "DIRECT", "HYBRID"];
// CORE   — footfall × conversion × ATV
// DIRECT — the user enters final sales directly
// HYBRID — CORE calculation + a separately-visible management adjustment

// ---- Core store-sales driver maths -------------------------------------

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const round2 = (n) => Math.round((num(n)) * 100) / 100;

// transactions = footfall × conversion (conversion held as a fraction 0..1).
export function transactionsFrom(footfall, conversion) {
  return num(footfall) * num(conversion);
}

// calculated sales = transactions × ATV = footfall × conversion × ATV.
export function calculatedSales(footfall, conversion, atv) {
  return transactionsFrom(footfall, conversion) * num(atv);
}

/*
 * The store sales build. Returns every rung of the ladder so the UI can show
 * footfall → transactions → calculated sales → adjustment → final sales, and so
 * the calculated figure is NEVER silently overwritten by a management
 * adjustment. `method` selects CORE / DIRECT / HYBRID.
 *   input: { method, footfall, conversion, atv, directSales, adjustmentAmount, adjustmentPct }
 */
export function buildStoreSales(input = {}) {
  const method = SALES_METHODS.includes(input.method) ? input.method : "CORE";
  const footfall = num(input.footfall);
  const conversion = num(input.conversion);
  const atv = num(input.atv);
  const transactions = transactionsFrom(footfall, conversion);
  const calculated = method === "DIRECT" ? num(input.directSales) : calculatedSales(footfall, conversion, atv);

  let adjustment = 0;
  if (method === "HYBRID") {
    // an explicit amount takes precedence; else a percentage of the calculated figure
    adjustment = input.adjustmentAmount != null && input.adjustmentAmount !== ""
      ? num(input.adjustmentAmount)
      : round2(calculated * num(input.adjustmentPct));
  }
  const finalSales = round2(calculated + adjustment);
  return {
    method,
    footfall,
    conversion,
    atv,
    transactions: round2(transactions),
    calculatedSales: round2(calculated),
    managementAdjustment: round2(adjustment),
    finalSales,
  };
}

/*
 * Compute a store's monthly net-sales plan lines from its driver inputs. Each
 * input row is a month; `resolveDriver(driverCode, period)` supplies a fallback
 * from the Assumption Register when an input field is blank (so a store can
 * inherit company/region defaults). Returns one line per period carrying the
 * final amount AND the full lineage (every rung of the ladder), so nothing is a
 * black box and a management adjustment is always visible separately from the
 * calculation. `nominal` is the account NAME the P&L template maps (e.g.
 * 'ST: Sales'). Pure.
 */
export function computeStoreSalesLines(inputs = [], { nominal = "ST: Sales", driverCode = "FOOTFALL_X_CONVERSION_X_ATV", resolveDriver } = {}) {
  const pick = (row, field, code) => {
    if (row[field] != null && row[field] !== "") return Number(row[field]);
    if (typeof resolveDriver === "function") { const v = resolveDriver(code, row.period); if (v != null) return Number(v); }
    return 0;
  };
  return (inputs || []).map((row) => {
    const build = buildStoreSales({
      method: row.method,
      footfall: pick(row, "footfall", "FOOTFALL"),
      conversion: pick(row, "conversion", "CONVERSION"),
      atv: pick(row, "atv", "ATV"),
      directSales: row.direct_sales,
      adjustmentAmount: row.adjustment_amount,
      adjustmentPct: row.adjustment_pct,
    });
    return {
      period: row.period,
      nominal,
      amount: build.finalSales,
      driver_code: driverCode,
      source: "SALES_DRIVER",
      lineage: {
        method: build.method,
        footfall: build.footfall,
        conversion: build.conversion,
        atv: build.atv,
        transactions: build.transactions,
        calculatedSales: build.calculatedSales,
        managementAdjustment: build.managementAdjustment,
        finalSales: build.finalSales,
      },
    };
  });
}

// ---- Assumption resolution (the precedence rule) -----------------------

// Does an assumption row apply to the given resolution context?
function assumptionMatches(a, ctx) {
  if (a.driver_code !== ctx.driverCode) return false;
  if (ctx.scope && a.scope && a.scope !== ctx.scope) return false;
  if (ctx.scenario && a.scenario_code && a.scenario_code !== ctx.scenario) return false;
  if (ctx.fiscalYear && a.fiscal_year && a.fiscal_year !== ctx.fiscalYear) return false;
  // period: a null period is a constant (applies to all months); a set period
  // must match the requested period.
  if (a.period != null && ctx.period != null && a.period !== ctx.period) return false;
  // effective dating (by period, when both are present)
  if (ctx.period != null) {
    if (a.effective_start && ctx.period < String(a.effective_start).slice(0, 7)) return false;
    if (a.effective_end && ctx.period > String(a.effective_end).slice(0, 7)) return false;
  }
  // level key must match the context value for that level
  switch (a.level) {
    case "COMPANY": return true;
    case "REGION": return !!ctx.region && a.level_key === ctx.region;
    case "ENTITY": return !!ctx.entity && a.level_key === ctx.entity;
    case "STORE": return !!ctx.storeCode && a.level_key === ctx.storeCode;
    default: return false;
  }
}

// Rank key for choosing the winner: more specific level, then period-specific
// over constant, then latest effective_start, then newest row.
function rank(a) {
  return [
    LEVEL_SPECIFICITY[a.level] || 0,
    a.period != null ? 1 : 0,
    a.effective_start ? String(a.effective_start) : "",
    Number(a.assumption_id) || 0,
  ];
}
function better(a, b) {
  const ra = rank(a), rb = rank(b);
  for (let i = 0; i < ra.length; i++) { if (ra[i] > rb[i]) return true; if (ra[i] < rb[i]) return false; }
  return false;
}

/*
 * Resolve the effective assumption for a driver in a context. `assumptions` is
 * the candidate rows for the driver (any level). By default only APPROVED rows
 * are considered; pass includeDrafts to preview. Returns the winning row plus
 * the level it came from, or null when nothing applies.
 *   ctx: { driverCode, scope, storeCode?, region?, entity?, period?, scenario?, fiscalYear?, includeDrafts? }
 */
export function resolveAssumption(assumptions = [], ctx = {}) {
  let winner = null;
  for (const a of assumptions) {
    if (!ctx.includeDrafts && a.approval_status !== "APPROVED") continue;
    if (!assumptionMatches(a, ctx)) continue;
    if (!winner || better(a, winner)) winner = a;
  }
  if (!winner) return null;
  return { value: Number(winner.value), level: winner.level, assumptionId: winner.assumption_id, source: winner.source || null, row: winner };
}

// ---- Validation ---------------------------------------------------------

export function validateDriverDefinition(d = {}) {
  if (!d.driver_code || !String(d.driver_code).trim()) return "Driver code is required";
  if (!d.description || !String(d.description).trim()) return "Description is required";
  if (!DRIVER_CATEGORIES.includes(d.category)) return "Unknown driver category";
  if (d.approval_status && !DRIVER_APPROVAL.includes(d.approval_status)) return "Unknown approval status";
  const scopes = d.permitted_scopes || [];
  for (const s of scopes) if (!PLANNING_SCOPES.includes(s)) return `Unknown scope: ${s}`;
  return null;
}

export function validateAssumption(a = {}) {
  if (!a.driver_code) return "Driver is required";
  if (!PLANNING_SCOPES.includes(a.scope)) return "Unknown planning scope";
  if (!ASSUMPTION_LEVELS.includes(a.level)) return "Unknown assumption level";
  if (a.level !== "COMPANY" && (a.level_key == null || a.level_key === "")) return `A ${a.level.toLowerCase()} key is required for a ${a.level.toLowerCase()}-level assumption`;
  if (a.value == null || a.value === "" || !Number.isFinite(Number(a.value))) return "A numeric value is required";
  if (a.period != null && a.period !== "" && !/^\d{4}-\d{2}$/.test(a.period)) return "Period must be YYYY-MM";
  if (a.approval_status && !ASSUMPTION_APPROVAL.includes(a.approval_status)) return "Unknown approval status";
  return null;
}
