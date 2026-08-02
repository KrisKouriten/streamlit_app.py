/*
 * Merchandising Open-to-Buy — pure rules. No imports, no DB. The sales
 * reconciliation + tolerance, the per-channel cost-of-sales, the minimum-stock
 * hierarchy, and the governed Remaining-OTB calculation (every component visible
 * and signed) all live here so they are unit-tested independently of the database
 * and the UI. Unit-tested in tests/otb-rules.test.mjs.
 *
 * OTB is computed SEPARATELY for the two purchase channels (Miniso MDS / Local
 * Purchase). The engine never stores only the final number — it returns each
 * component with its sign so the Remaining OTB is fully auditable.
 */

export const OTB_CHANNELS = ["MINISO_MDS", "LOCAL_PURCHASE"];
export const CHANNEL_LABEL = { MINISO_MDS: "Miniso MDS", LOCAL_PURCHASE: "Local Purchase" };

export const TOLERANCE_STATUS = {
  WITHIN: "WITHIN_TOLERANCE", WARNING: "WARNING", OUTSIDE: "OUTSIDE_TOLERANCE", EXCEPTION: "APPROVED_EXCEPTION",
};
export const OTB_VALIDATION = {
  WITHIN: "WITHIN_OTB", WARNING: "OTB_WARNING", EXCEEDS: "EXCEEDS_OTB",
  NONE: "NO_APPROVED_OTB", EXCEPTION: "APPROVED_EXCEPTION",
};

// The signed component ledger that makes up Remaining OTB. `+` adds purchasing
// requirement, `−` reduces it (existing/committed stock, clearance).
export const OTB_COMPONENTS = [
  { code: "PLANNED_COS", label: "Planned cost of sales", sign: 1 },
  { code: "TARGET_CLOSING_STOCK", label: "Target closing stock", sign: 1 },
  { code: "NEW_STORE", label: "New-store opening stock", sign: 1 },
  { code: "FITOUT", label: "Fit-out inventory investment", sign: 1 },
  { code: "ADJUSTMENTS", label: "Approved adjustments", sign: 1 },
  { code: "OPENING_STORE_STOCK", label: "Opening store stock", sign: -1 },
  { code: "OPENING_WAREHOUSE_STOCK", label: "Opening warehouse stock", sign: -1 },
  { code: "IN_TRANSIT", label: "Stock in transit", sign: -1 },
  { code: "CLOSURE_TRANSFERABLE", label: "Transferable closure stock", sign: -1 },
  { code: "OPEN_COMMITMENTS", label: "Open purchase commitments", sign: -1 },
  { code: "APPROVED_REQUESTS", label: "Approved (not ordered) requests", sign: -1 },
  { code: "CLEARANCE_REDUCTION", label: "Expected clearance reduction", sign: -1 },
];
const COMPONENT_SIGN = Object.fromEntries(OTB_COMPONENTS.map((c) => [c.code, c.sign]));

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => Number(v) || 0;

// Average weeks in a calendar month, for weeks-of-cover → value conversions.
export const WEEKS_PER_MONTH = 4.345;

// ---------------------------------------------------------------------------
// Sales reconciliation & tolerance
// ---------------------------------------------------------------------------

// Split a store's total sales into a channel amount by mix percentage.
export function splitByMix(totalSales, mixPct) {
  return round2((num(totalSales) * num(mixPct)) / 100);
}

// Validate that a set of channel mix percentages totals 100 (±0.1).
export function mixError(mixByChannel = {}) {
  const total = round2(Object.values(mixByChannel).reduce((t, v) => t + num(v), 0));
  if (Math.abs(total - 100) > 0.1) return `Channel mix must total 100% — it currently totals ${total}%`;
  return null;
}

// Reconcile the combined channel sales to an approved store-sales figure. Returns
// the difference, the difference %, and a status. `type` selects the tolerance
// basis: PCT (percentage), ABS (absolute £), or BOTH (must satisfy both).
export function reconcileTolerance({ approved, otbTotal, tolerancePct = 1.0, toleranceAbs = null, type = "PCT" } = {}) {
  const a = num(approved), o = num(otbTotal);
  const diff = round2(o - a);
  const diffPct = a !== 0 ? round2((diff / a) * 100) : (o === 0 ? 0 : 100);
  const pctOk = Math.abs(diffPct) <= num(tolerancePct);
  const absOk = toleranceAbs == null ? true : Math.abs(diff) <= num(toleranceAbs);
  const within = type === "ABS" ? absOk : type === "BOTH" ? (pctOk && absOk) : pctOk;
  let status;
  if (within) status = TOLERANCE_STATUS.WITHIN;
  else if (Math.abs(diffPct) <= num(tolerancePct) * 2) status = TOLERANCE_STATUS.WARNING;
  else status = TOLERANCE_STATUS.OUTSIDE;
  return { diff, diffPct, status, within };
}

// Sum channel amounts and reconcile to the approved store sales for one store.
export function reconcileStore({ approvedStoreSales, channelAmounts = {}, tolerancePct = 1.0, toleranceAbs = null, type = "PCT" } = {}) {
  const otbTotal = round2(Object.values(channelAmounts).reduce((t, v) => t + num(v), 0));
  const rec = reconcileTolerance({ approved: approvedStoreSales, otbTotal, tolerancePct, toleranceAbs, type });
  return { otbTotal, approvedStoreSales: round2(num(approvedStoreSales)), ...rec };
}

// ---------------------------------------------------------------------------
// Cost of sales & target stock (per channel)
// ---------------------------------------------------------------------------

// Planned cost of sales for a channel from its sales and either a cost-of-sales
// rate or a gross-margin rate (cos = 1 − gm). Retains the rate used by the caller.
export function plannedCostOfSales(salesForecast, { cosRate = null, grossMarginRate = null } = {}) {
  const s = num(salesForecast);
  const rate = cosRate != null ? num(cosRate) : (grossMarginRate != null ? 1 - num(grossMarginRate) : null);
  if (rate == null) return null;
  return round2(s * rate);
}

// Target closing stock from weeks of cover: (cost of sales per week) × target weeks.
export function targetStockFromWeeks(plannedCos, targetWeeks, weeksInPeriod = WEEKS_PER_MONTH) {
  if (targetWeeks == null) return null;
  const perWeek = num(plannedCos) / (num(weeksInPeriod) || WEEKS_PER_MONTH);
  return round2(perWeek * num(targetWeeks));
}

// Only genuinely available warehouse stock reduces OTB — reserved and damaged are
// excluded unless a rule says otherwise.
export function availableWarehouse({ stockValue, reservedValue = 0, damagedValue = 0 } = {}) {
  return round2(Math.max(0, num(stockValue) - num(reservedValue) - num(damagedValue)));
}

// In-transit value risk-adjusted by arrival confidence (0..1).
export function inTransitAvailable({ value, confidence = 1 } = {}) {
  return round2(num(value) * Math.min(1, Math.max(0, num(confidence))));
}

// Expected inventory reduction from a clearance plan, at a realisation rate.
export function clearanceReduction({ stockValue, realisationRate = 0.7 } = {}) {
  return round2(num(stockValue) * Math.min(1, Math.max(0, num(realisationRate))));
}

// ---------------------------------------------------------------------------
// Minimum stock hierarchy
// ---------------------------------------------------------------------------

// Most-specific-first: CATEGORY > STORE > REGION > STORE_TYPE > COMPANY.
const MIN_STOCK_RANK = { CATEGORY: 4, STORE: 3, REGION: 2, STORE_TYPE: 1, COMPANY: 0 };

// Resolve the minimum-stock rule that applies to a context. Returns the winning
// rule (or null). Channel-specific rules beat all-channel rules at the same level.
export function resolveMinStock(rules = [], ctx = {}) {
  const match = (r) => {
    if (r.active === false) return false;
    if (r.channel_code && ctx.channelCode && r.channel_code !== ctx.channelCode) return false;
    switch (r.level) {
      case "COMPANY": return true;
      case "STORE_TYPE": return r.match_value === ctx.storeFormat;
      case "REGION": return r.match_value === ctx.region;
      case "STORE": return r.match_value === ctx.storeCode;
      case "CATEGORY": return r.match_value === ctx.category;
      default: return false;
    }
  };
  let best = null, bestRank = -1;
  for (const r of rules) {
    if (!match(r)) continue;
    const rank = (MIN_STOCK_RANK[r.level] ?? -1) + (r.channel_code ? 0.5 : 0);
    if (rank > bestRank) { best = r; bestRank = rank; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The Remaining OTB calculation
// ---------------------------------------------------------------------------

// Compute Remaining OTB for one channel × period from its component inputs. Every
// input is a £ value already resolved by the caller (availability, confidence and
// realisation applied). Returns the signed component list and the remaining total.
export function computeRemainingOtb(inputs = {}) {
  const raw = {
    PLANNED_COS: num(inputs.plannedCos),
    TARGET_CLOSING_STOCK: num(inputs.targetClosingStock),
    NEW_STORE: num(inputs.newStoreStock),
    FITOUT: num(inputs.fitoutInventory),
    ADJUSTMENTS: num(inputs.adjustments),
    OPENING_STORE_STOCK: num(inputs.openingStoreStock),
    OPENING_WAREHOUSE_STOCK: num(inputs.openingWarehouseStock),
    IN_TRANSIT: num(inputs.inTransit),
    CLOSURE_TRANSFERABLE: num(inputs.closureTransferable),
    OPEN_COMMITMENTS: num(inputs.openCommitments),
    APPROVED_REQUESTS: num(inputs.approvedRequests),
    CLEARANCE_REDUCTION: num(inputs.clearanceReduction),
  };
  const components = OTB_COMPONENTS.map((c) => ({
    code: c.code, label: c.label, sign: c.sign, amount: round2(raw[c.code] || 0),
  }));
  const remainingOtb = round2(components.reduce((t, c) => t + c.sign * c.amount, 0));
  return { components, remainingOtb };
}

// ---------------------------------------------------------------------------
// Procurement request validation against remaining OTB
// ---------------------------------------------------------------------------

// Validate a procurement request value against the channel's remaining OTB for the
// period. Returns { status, remainingBefore, remainingAfter } — a request that
// would exceed OTB is blocked (EXCEEDS_OTB) unless an authorised exception is set.
export function validateAgainstOtb({ requestValue, remainingBefore, hasApprovedOtb = true, warnThresholdPct = 90, exceptionApproved = false } = {}) {
  const v = num(requestValue);
  const before = num(remainingBefore);
  const after = round2(before - v);
  if (exceptionApproved) return { status: OTB_VALIDATION.EXCEPTION, remainingBefore: round2(before), remainingAfter: after };
  if (!hasApprovedOtb) return { status: OTB_VALIDATION.NONE, remainingBefore: round2(before), remainingAfter: after };
  if (after < 0) return { status: OTB_VALIDATION.EXCEEDS, remainingBefore: round2(before), remainingAfter: after };
  const usedPct = before > 0 ? ((before - after) / before) * 100 + (before === v ? 0 : 0) : 100;
  // Warn when this request consumes most of the remaining OTB.
  const warn = before > 0 && (v / before) * 100 >= num(warnThresholdPct);
  return { status: warn ? OTB_VALIDATION.WARNING : OTB_VALIDATION.WITHIN, remainingBefore: round2(before), remainingAfter: after };
}

// Landed cost of a request = purchase value + freight + duty, at the FX rate.
export function landedCost({ purchaseValue, freight = 0, duty = 0, fxRate = 1 } = {}) {
  return round2((num(purchaseValue) + num(freight) + num(duty)) * (num(fxRate) || 1));
}

export { COMPONENT_SIGN };
