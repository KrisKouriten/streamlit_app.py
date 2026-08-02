/*
 * Capex Investment — pure rules. No imports, no DB. The investment appraisal maths
 * (NPV, IRR, payback, ROCE), the multi-year P&L → EBITDA → free-cash-flow model
 * generalised from the single-store model, and the portfolio consolidation +
 * capital allocation all live here so they are unit-tested independently of the
 * database and the UI. Unit-tested in tests/capex-rules.test.mjs.
 */

export const INVESTMENT_TYPES = [
  "NEW_STORE", "REFURBISHMENT", "WAREHOUSE", "OFFICE", "IT", "DISTRIBUTION", "FRANCHISE", "ACQUISITION", "OTHER",
];
export const INVESTMENT_COMPONENTS = [
  "fit_out", "fixtures", "it", "inventory", "professional_fees", "marketing", "working_capital", "contingency", "other",
];

const num = (v) => Number(v) || 0;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

// Total investment from its components.
export function totalInvestment(inv = {}) {
  return r2(INVESTMENT_COMPONENTS.reduce((t, k) => t + num(inv[k]), 0));
}

// Net present value of a cashflow series (cashflows[0] is t0).
export function npv(rate, cashflows = []) {
  const rr = num(rate);
  return r2(cashflows.reduce((t, cf, i) => t + num(cf) / Math.pow(1 + rr, i), 0));
}

// Internal rate of return by bisection. Returns a fraction (0.23 = 23%) or null
// when there is no sign change (no real IRR in range).
export function irr(cashflows = [], { lo = -0.9, hi = 10, iterations = 200 } = {}) {
  const f = (rate) => cashflows.reduce((t, cf, i) => t + num(cf) / Math.pow(1 + rate, i), 0);
  let a = lo, b = hi, fa = f(a), fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return null;
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (Math.abs(fm) < 1e-7) return r4(m);
    if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
  }
  return r4((a + b) / 2);
}

// Payback period in years (with fractional interpolation within the recovery year).
// cashflows[0] is the (negative) initial outlay. Returns null if never recovered.
export function payback(cashflows = []) {
  let cum = 0;
  for (let i = 0; i < cashflows.length; i++) {
    const cf = num(cashflows[i]);
    const prev = cum;
    cum += cf;
    if (cum >= 0 && i > 0) {
      const frac = cf !== 0 ? -prev / cf : 0;
      return r2((i - 1) + frac);
    }
  }
  return null;
}

// Return on capital employed = EBIT / capital employed.
export function roce(ebit, capitalEmployed) {
  const ce = num(capitalEmployed);
  return ce > 0 ? r4(num(ebit) / ce) : null;
}

// The multi-year financial model for one project. Returns per-year rows + summary.
// Revenue grows from year1Revenue at revenueGrowthPct; costs are % of revenue (or
// fixed if the *_fixed variant is given). Depreciation is straight-line over
// depreciationYears on the depreciable capex (default: total minus inventory +
// working capital). FCF = EBITDA − tax (depreciation is non-cash); t0 = −investment.
export function projectModel(input = {}) {
  const years = Math.max(1, Math.round(num(input.years) || 10));
  const invest = totalInvestment(input.investment || {});
  const depreciable = input.depreciable_capex != null ? num(input.depreciable_capex)
    : invest - num(input.investment?.inventory) - num(input.investment?.working_capital);
  const depYears = Math.max(1, Math.round(num(input.depreciation_years) || 7));
  const tax = num(input.tax_rate) || 0;
  const gm = num(input.gross_margin_pct);
  const rows = [];
  const fcfSeries = [-invest];
  for (let y = 1; y <= years; y++) {
    const revenue = num(input.year1_revenue) * Math.pow(1 + num(input.revenue_growth_pct), y - 1);
    const grossProfit = revenue * gm;
    const payroll = input.payroll_fixed != null ? num(input.payroll_fixed) : revenue * num(input.payroll_pct);
    const opex = input.opex_fixed != null ? num(input.opex_fixed) : revenue * num(input.opex_pct);
    const ebitda = grossProfit - payroll - opex;
    const depreciation = y <= depYears ? depreciable / depYears : 0;
    const ebit = ebitda - depreciation;
    const taxCharge = Math.max(0, ebit * tax);
    const profit = ebit - taxCharge;
    const fcf = ebitda - taxCharge;
    fcfSeries.push(fcf);
    rows.push({
      year: y, revenue: r2(revenue), grossProfit: r2(grossProfit), payroll: r2(payroll), opex: r2(opex),
      ebitda: r2(ebitda), ebitdaMargin: revenue > 0 ? r4(ebitda / revenue) : null,
      depreciation: r2(depreciation), ebit: r2(ebit), tax: r2(taxCharge), profit: r2(profit), fcf: r2(fcf),
    });
  }
  let cum = -invest;
  const cumulative = rows.map((r) => { cum += r.fcf; return r2(cum); });
  const discount = num(input.discount_rate) || 0.1;
  const avgEbitdaMargin = rows.length ? r4(rows.reduce((t, r) => t + (r.ebitdaMargin || 0), 0) / rows.length) : null;
  return {
    totalInvestment: invest,
    rows, cumulative, fcfSeries,
    summary: {
      totalInvestment: invest,
      npv: npv(discount, fcfSeries),
      irr: irr(fcfSeries),
      payback: payback(fcfSeries),
      avgEbitdaMargin,
      roceYear1: roce(rows[0]?.ebit, invest),
      discountRate: discount,
    },
  };
}

// Consolidate several project models into a portfolio: total investment, combined
// cashflows, portfolio NPV/IRR/payback, and average IRR/payback across projects.
export function portfolio(models = [], { discountRate = 0.1 } = {}) {
  if (!models.length) return { totalInvestment: 0, projects: 0, npv: 0, irr: null, payback: null, avgIrr: null, avgPayback: null, avgEbitdaMargin: null };
  const maxLen = Math.max(...models.map((m) => m.fcfSeries.length));
  const combined = Array.from({ length: maxLen }, (_, i) => models.reduce((t, m) => t + num(m.fcfSeries[i]), 0));
  const irrs = models.map((m) => m.summary.irr).filter((v) => v != null);
  const paybacks = models.map((m) => m.summary.payback).filter((v) => v != null);
  const margins = models.map((m) => m.summary.avgEbitdaMargin).filter((v) => v != null);
  return {
    totalInvestment: r2(models.reduce((t, m) => t + m.totalInvestment, 0)),
    projects: models.length,
    npv: npv(discountRate, combined),
    irr: irr(combined),
    payback: payback(combined),
    avgIrr: irrs.length ? r4(irrs.reduce((a, b) => a + b, 0) / irrs.length) : null,
    avgPayback: paybacks.length ? r2(paybacks.reduce((a, b) => a + b, 0) / paybacks.length) : null,
    avgEbitdaMargin: margins.length ? r4(margins.reduce((a, b) => a + b, 0) / margins.length) : null,
  };
}

// Capital allocation position above the portfolio.
export function capitalAllocation({ capitalAvailable = 0, committed = 0, cashAvailable = 0 } = {}, port = {}) {
  const remaining = r2(num(capitalAvailable) - num(committed));
  const fundingRequired = r2(Math.max(0, num(committed) - num(cashAvailable)));
  return {
    capitalAvailable: r2(num(capitalAvailable)),
    committed: r2(num(committed)),
    remaining,
    cashAvailable: r2(num(cashAvailable)),
    fundingRequired,
    projects: port.projects || 0,
    avgIrr: port.avgIrr ?? null,
    avgPayback: port.avgPayback ?? null,
  };
}

// Does a project clear the hurdle rate?
export function clearsHurdle(projectSummary = {}, hurdleRate = 0.15) {
  if (projectSummary.irr == null) return null;
  return projectSummary.irr >= num(hurdleRate);
}
