/*
 * Pricing Review — pure rules. No imports, no DB. The full SKU cost build (RMB
 * cost → FOB → freight → landed → distribution → total cost → wholesale /
 * distributor / retail), the margin analysis, the ABC/XYZ classification, the
 * Pricing Health Score (0–100) and the what-if sensitivity all live here so they
 * are unit-tested independently of the database and the UI. Unit-tested in
 * tests/pricing-rules.test.mjs.
 *
 * KEY RULE: Air freight is PART OF freight. Total Freight = sea + air + duty +
 * insurance + port + customs + other. There is never a separate air-freight
 * adjustment. Landed Cost = GBP FOB + Total Freight.
 *
 * Convention: fx_rate is RMB per GBP (e.g. 8.8), so GBP = RMB / fx. Margins are on
 * the SELLING price (price = cost / (1 − margin)). VAT is added to the ex-VAT
 * selling price to give the RRP.
 */

export const PRICING_CHANNELS = ["MINISO_MDS", "LOCAL_PURCHASE"];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const num = (v) => Number(v) || 0;
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

// ---------------------------------------------------------------------------
// Cost build
// ---------------------------------------------------------------------------

// The seven freight components. Air freight is one of them — not separate.
export const FREIGHT_COMPONENTS = ["sea_freight", "air_freight", "duty", "insurance", "port_charges", "customs", "other_import"];
export const DISTRIBUTION_COMPONENTS = ["goods_in", "goods_out", "warehouse_storage", "warehouse_admin", "handling", "other_logistics"];

export function totalFreight(input = {}) {
  return r4(FREIGHT_COMPONENTS.reduce((t, k) => t + num(input[k]), 0));
}
export function totalDistribution(input = {}) {
  return r4(DISTRIBUTION_COMPONENTS.reduce((t, k) => t + num(input[k]), 0));
}

// Compute the full cost build from a SKU's inputs. Returns every intermediate so
// the build is transparent and auditable.
export function computeCostBuild(input = {}) {
  const netRmb = r4(num(input.rmb_cost) * (1 - num(input.discount_pct)));
  const fx = num(input.fx_rate) || 1;
  const gbpFob = r4(netRmb / fx);
  const freight = totalFreight(input);
  const landed = r4(gbpFob + freight);
  const distribution = totalDistribution(input);
  const totalCost = r4(landed + distribution);
  return { netRmb, gbpFob, freight, landed, distribution, totalCost };
}

// ---------------------------------------------------------------------------
// Price chain (margins on selling price)
// ---------------------------------------------------------------------------

// price = cost / (1 − margin). Guards a margin ≥ 100%.
function markUp(cost, marginPct) {
  const m = num(marginPct);
  if (m >= 1) return null;
  return r2(num(cost) / (1 - m));
}

// Wholesale → distributor → retail (ex VAT), then RRP incl VAT.
export function computePriceChain(totalCost, { wholesaleMargin = 0, distributorMargin = 0, vat = 0.2 } = {}) {
  const wholesale = markUp(totalCost, wholesaleMargin);
  const distributor = wholesale == null ? null : markUp(wholesale, distributorMargin);
  const retailExVat = distributor;                     // the ex-VAT selling price to retail
  const rrpInclVat = retailExVat == null ? null : r2(retailExVat * (1 + num(vat)));
  return { wholesale, distributor, retailExVat, rrpInclVat };
}

// ---------------------------------------------------------------------------
// Margin analysis
// ---------------------------------------------------------------------------

// Gross profit vs total cost at a selling price. Pass sellingInclVat (a live RRP)
// or sellingExVat directly. Returns { sellingExVat, gp, gpPct, markup }.
export function marginAnalysis({ sellingInclVat = null, sellingExVat = null, totalCost = 0, vat = 0.2 } = {}) {
  const exVat = sellingExVat != null ? num(sellingExVat) : (sellingInclVat != null ? num(sellingInclVat) / (1 + num(vat)) : 0);
  const cost = num(totalCost);
  const gp = r2(exVat - cost);
  const gpPct = exVat > 0 ? r4(gp / exVat) : null;
  const markup = cost > 0 ? r4((exVat - cost) / cost) : null;
  return { sellingExVat: r2(exVat), gp, gpPct, markup };
}

// The ex-VAT selling price (and RRP) that achieves a target gross-margin %.
export function priceForTargetGp(totalCost, targetGpPct, vat = 0.2) {
  const t = num(targetGpPct);
  if (t >= 1) return null;
  const exVat = r2(num(totalCost) / (1 - t));
  return { sellingExVat: exVat, rrpInclVat: r2(exVat * (1 + num(vat))) };
}

// Freight burden = total freight ÷ landed cost.
export function freightBurden(input = {}) {
  const b = computeCostBuild(input);
  return b.landed > 0 ? r4(b.freight / b.landed) : null;
}

// ---------------------------------------------------------------------------
// ABC / XYZ classification
// ---------------------------------------------------------------------------

// ABC on cumulative revenue share (Pareto): A ≤ 80%, B ≤ 95%, else C.
export function classifyAbc(cumulativeRevenuePct) {
  const c = num(cumulativeRevenuePct);
  if (c <= 0.8) return "A";
  if (c <= 0.95) return "B";
  return "C";
}

// XYZ on demand variability (coefficient of variation): X steady ≤ 0.5, Y ≤ 1.0, Z erratic.
export function classifyXyz(coefficientOfVariation) {
  const cv = num(coefficientOfVariation);
  if (cv <= 0.5) return "X";
  if (cv <= 1.0) return "Y";
  return "Z";
}

// ---------------------------------------------------------------------------
// Pricing Health Score (0–100)
// ---------------------------------------------------------------------------

// Bands aligned to the change-request scale (95 Excellent, 87 Healthy, 71 Monitor,
// 56 Margin risk, 32 Immediate review).
export const HEALTH_BANDS = [
  { min: 90, label: "Excellent", tone: "green" },
  { min: 80, label: "Healthy", tone: "green" },
  { min: 65, label: "Monitor", tone: "amber" },
  { min: 45, label: "Margin risk", tone: "amber" },
  { min: 0, label: "Immediate review", tone: "red" },
];
export function healthBand(score) {
  return HEALTH_BANDS.find((b) => num(score) >= b.min) || HEALTH_BANDS[HEALTH_BANDS.length - 1];
}

// The score is a weighted composite of the available factors — each scored 0–100.
// Missing inputs drop out and the remaining weights renormalise, so a partially
// populated SKU still scores. Returns { score, band, factors:[{key,score,weight}] }.
export function healthScore(f = {}) {
  const factors = [];
  const add = (key, score, weight) => { if (score != null && Number.isFinite(score)) factors.push({ key, score: clamp(score), weight }); };

  // Gross margin vs target (the biggest driver).
  if (f.gpPct != null) {
    const target = num(f.targetGpPct) || 0.5;
    add("margin", (num(f.gpPct) / target) * 100, 0.30);
  }
  // Absolute GP contribution per unit relative to selling price.
  if (f.gpPct != null) add("contribution", num(f.gpPct) > 0 ? 60 + num(f.gpPct) * 80 : 0, 0.10);
  // Freight burden — lower is better (0%→100, 50%→0).
  if (f.freightBurden != null) add("freight", 100 - num(f.freightBurden) * 200, 0.15);
  // Weeks of cover — ideal band 4–12 weeks; too little or too much scores down.
  if (f.weeksCover != null) {
    const w = num(f.weeksCover);
    const s = w >= 4 && w <= 12 ? 100 : w < 4 ? w / 4 * 100 : Math.max(0, 100 - (w - 12) * 8);
    add("cover", s, 0.15);
  }
  // Sell-through — higher is better (0.8 → 100).
  if (f.sellThroughPct != null) add("sellThrough", (num(f.sellThroughPct) / 0.8) * 100, 0.15);
  // Markdown dependency — higher reliance scores down.
  if (f.markdownPct != null) add("markdown", 100 - num(f.markdownPct) * 200, 0.10);
  // FX sensitivity — margin-point loss from a 10% adverse FX move; more = worse.
  if (f.fxMarginSensitivity != null) add("fx", 100 - Math.abs(num(f.fxMarginSensitivity)) * 500, 0.05);

  if (!factors.length) return { score: null, band: null, factors: [] };
  const wsum = factors.reduce((t, x) => t + x.weight, 0);
  const score = Math.round(factors.reduce((t, x) => t + x.score * x.weight, 0) / wsum);
  return { score, band: healthBand(score), factors };
}

// ---------------------------------------------------------------------------
// What-if sensitivity
// ---------------------------------------------------------------------------

// Recompute the cost build + margin under shocks: fxTo (new RMB/GBP), freightPct
// (± on total freight), discountPct (new discount). Selling price held at the
// current ex-VAT selling price unless a new one is given.
export function whatIf(input = {}, { fxTo = null, freightPct = null, discountTo = null, sellingExVat = null } = {}) {
  const shocked = { ...input };
  if (fxTo != null) shocked.fx_rate = fxTo;
  if (discountTo != null) shocked.discount_pct = discountTo;
  if (freightPct != null) for (const k of FREIGHT_COMPONENTS) shocked[k] = num(input[k]) * (1 + num(freightPct));
  const build = computeCostBuild(shocked);
  const sell = sellingExVat != null ? num(sellingExVat)
    : (input.actual_retail_price != null ? num(input.actual_retail_price) / (1 + num(input.retail_vat_pct || 0.2)) : null);
  const margin = sell != null ? marginAnalysis({ sellingExVat: sell, totalCost: build.totalCost }) : null;
  return { build, margin };
}

// Margin-point sensitivity to a 10% adverse FX move (RMB weakens → GBP cost up),
// used as a health-score input. Returns the drop in gpPct (a positive number).
export function fxMarginSensitivity(input = {}, sellingExVat) {
  const base = marginAnalysis({ sellingExVat, totalCost: computeCostBuild(input).totalCost });
  const shocked = whatIf(input, { fxTo: num(input.fx_rate) * 0.9, sellingExVat });
  if (base.gpPct == null || shocked.margin?.gpPct == null) return null;
  return r4(base.gpPct - shocked.margin.gpPct);
}

// The complete per-SKU pricing view — the cost build, price chain, margin at the
// live selling price, freight burden and the health score in one call.
export function priceSku(input = {}, commercial = {}) {
  const build = computeCostBuild(input);
  const chain = computePriceChain(build.totalCost, {
    wholesaleMargin: input.wholesale_margin_pct, distributorMargin: input.distributor_margin_pct, vat: input.retail_vat_pct,
  });
  const sellingInclVat = input.actual_retail_price != null ? num(input.actual_retail_price) : chain.rrpInclVat;
  const margin = marginAnalysis({ sellingInclVat, totalCost: build.totalCost, vat: input.retail_vat_pct });
  const burden = build.landed > 0 ? r4(build.freight / build.landed) : null;
  const fxSens = sellingInclVat != null ? fxMarginSensitivity(input, margin.sellingExVat) : null;
  const health = healthScore({
    gpPct: margin.gpPct, targetGpPct: input.target_gp_pct, freightBurden: burden,
    weeksCover: commercial.weeksCover, sellThroughPct: commercial.sellThroughPct,
    markdownPct: commercial.markdownPct, fxMarginSensitivity: fxSens,
  });
  return { build, chain, margin, freightBurden: burden, fxMarginSensitivity: fxSens, health };
}
