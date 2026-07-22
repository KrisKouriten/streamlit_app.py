import { classifyEntity } from "./pl-format.js";
import { computeForecast, computeNominalPnl } from "./forecast-rules.js";
import { BELOW_EBITDA, ebitda, variance } from "./ma-dashboard-rules.js";

/*
 * Management Accounts Dashboard — analysis tabs (pure). Builds each tab's
 * dataset from the per-entity actuals (finance.joiin_pl_entity rows) and the
 * forecast (finance.forecast_line rows), comparing specific nominals. The
 * nominal definitions below are grounded in the real account/label strings in
 * the two feeds and are deliberately explicit so they're easy to audit and
 * adjust. Costs are held positive; EBITDA is operating (before D&A / finance).
 */

// --- nominal matchers (actual account strings ‖ forecast line labels) --------
const A = {
  storeSales: (a) => a === "ST: Sales",
  storeLabour: (a) => /^ST: Salaries/.test(a) || a === "ST: Pensions Costs" || a === "ST: Employers National Insurance",
  wholesaleSales: (a) => /^HO:/.test(a),                       // HO-prefixed revenue = wholesale
  warehouseLogistics: (a) => ["HO: Goods In", "HO: Goods Out", "HO: Logistics Administration", "HO: Warehouse Storage"].includes(a),
  wholesaleCogs: (a) => /^HO: (Cost of Goods Sold|FX|Import Duty|Furniture COS)/.test(a),
  marketing: (a) => /advertising & marketing|printing & stationery/i.test(a),
  frRoyalty: (a) => /franchise fee - royalt/i.test(a),
  frMarketing: (a) => /franchise fee - marketing/i.test(a),
};
const F = {
  storeLabour: (l) => /^ST: Salaries/.test(l),
  warehouseLogistics: (l) => ["HO: Goods In", "HO: Goods Out", "HO: Logistics Administration", "HO: Warehouse Storage"].includes(l),
  marketing: (l) => /advertising & marketing|printing & stationery/i.test(l),
  frRoyalty: (l) => /franchise fee - (royalt|store)/i.test(l),        // forecast calls it "Store"
  frMarketing: (l) => /franchise fee - marketing|advetisment levy/i.test(l),
};

const MARKETING_NOMS = ["Advertising & Marketing", "Printing & Stationery"];
const WL_NOMS = ["HO: Goods In", "HO: Goods Out", "HO: Logistics Administration", "HO: Warehouse Storage"];

// --- helpers ----------------------------------------------------------------
const sumMonths = (series, months) => months.reduce((t, m) => t + (series[m] || 0), 0);

// actual account series {ym: total} over rows passing filter (row: {scope, account, ym, value})
function actualSeries(rows, filter) {
  const s = {};
  for (const r of rows) if (filter(r)) s[r.ym] = (s[r.ym] || 0) + Number(r.value);
  return s;
}

// forecast nominal series {ym: total} from computeNominalPnl rows matching label
function fcNominalSeries(nominalRows, matchLabel) {
  const s = {};
  for (const r of nominalRows) if (matchLabel(r.line_label)) for (const [ym, v] of Object.entries(r.months)) s[ym] = (s[ym] || 0) + v;
  return s;
}

// Classify entities → scope; also expose store display names.
function scopeMap(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.entity_id)) byId.set(r.entity_id, { name: r.entity_name, accounts: new Set() });
    byId.get(r.entity_id).accounts.add(r.account);
  }
  const scopeOf = {}, nameOf = {};
  for (const [id, e] of byId) {
    nameOf[id] = e.name;
    if (classifyEntity(e.name, [...e.accounts]) === "store") scopeOf[id] = "store";
    else if (e.name === "Kouriten Limited") scopeOf[id] = "head_office";
    else if (/franchise/i.test(e.name)) scopeOf[id] = "franchise";
  }
  return { scopeOf, nameOf };
}

const display = (name) => name.replace(/^Kouriten\s+/, "").replace(/\s+(Limited|Ltd)$/, "");

// Main entry: returns { [tabKey]: dataset }. period: "current" | "ytd".
export function buildTabs(entityRows, forecastLines, { period = "ytd", year = null } = {}) {
  const { scopeOf, nameOf } = scopeMap(entityRows);
  const rows = entityRows.map((r) => ({ ...r, scope: scopeOf[r.entity_id] || null, value: Number(r.value) }));

  const allYm = [...new Set(rows.map((r) => r.ym))].sort();
  const years = [...new Set(allYm.map((m) => m.slice(0, 4)))].sort();
  const yr = year && years.includes(year) ? year : years[years.length - 1] || null;
  const actualMonths = allYm.filter((m) => m.startsWith(yr || ""));
  const periodMonths = period === "ytd" ? actualMonths : actualMonths.slice(-1);

  const fc = forecastLines.length ? computeForecast(forecastLines) : null;
  // Full-year forecast months (for the 12-month graph), in the year in view.
  const fcMonths = fc ? [...new Set(forecastLines.filter((l) => l.ym && l.ym.startsWith(yr || "")).map((l) => l.ym))].sort() : [];
  const nom = (scope) => (forecastLines.length ? computeNominalPnl(forecastLines, { scope }).rows : []);
  const nomStores = nom("STORES"), nomHO = nom("HEAD_OFFICE"), nomFR = nom("FRANCHISE");
  const scopeSeries = (scope, key) => { const s = {}; if (fc) for (const m of Object.keys(fc.byScope[scope].months)) s[m] = fc.byScope[scope].months[m][key]; return s; };

  const V = (a, f, fav = true) => variance(a, f == null ? null : f, fav);
  const hasFc = !!fc;

  // ---- Store Sales -------------------------------------------------------
  const storeIds = Object.keys(scopeOf).filter((id) => scopeOf[id] === "store");
  const storeSalesActual = actualSeries(rows, (r) => r.scope === "store" && A.storeSales(r.account));
  const fcStoreSales = scopeSeries("STORES", "sales");
  const storeSalesRows = storeIds.map((id) => {
    const a = sumMonths(actualSeries(rows.filter((r) => r.entity_id === id), (r) => A.storeSales(r.account)), periodMonths);
    const fUnit = hasFc ? computeNominalPnl(forecastLines, { scope: "STORES", unit: display(nameOf[id]) }) : null;
    const f = fUnit ? sumMonths(fUnit.totals.sales.months, periodMonths) : null;
    return { label: display(nameOf[id]), a, f };
  }).filter((r) => r.a || r.f).sort((x, y) => y.a - x.a);
  const storeSales = {
    label: "Store Sales", blurb: "Company-store sales versus forecast. The chart shows the full 12-month forecast against year-to-date actuals.",
    kpis: [{ label: "Store sales", ...V(sumMonths(storeSalesActual, periodMonths), hasFc ? sumMonths(fcStoreSales, periodMonths) : null) }],
    table: { cols: ["Store", "Actual", "Forecast", "Variance"], rows: storeSalesRows.map((r) => ({ cells: [r.label, r.a, r.f, V(r.a, r.f)] })), totalRow: { cells: ["All stores", sumMonths(storeSalesActual, periodMonths), hasFc ? sumMonths(fcStoreSales, periodMonths) : null, V(sumMonths(storeSalesActual, periodMonths), hasFc ? sumMonths(fcStoreSales, periodMonths) : null)] } },
    graph: hasFc ? { label: "Store sales — 12-month forecast vs YTD actual", months: fcMonths, forecast: fcMonths.map((m) => fcStoreSales[m] || 0), actual: fcMonths.map((m) => (actualMonths.includes(m) ? (storeSalesActual[m] || 0) : null)) } : null,
  };

  // ---- Store Labour ------------------------------------------------------
  const labourActual = actualSeries(rows, (r) => r.scope === "store" && A.storeLabour(r.account));
  const fcLabour = fcNominalSeries(nomStores, F.storeLabour);
  const labA = sumMonths(labourActual, periodMonths), salesA = sumMonths(storeSalesActual, periodMonths);
  const labF = hasFc ? sumMonths(fcLabour, periodMonths) : null, salesF = hasFc ? sumMonths(fcStoreSales, periodMonths) : null;
  const labourRows = storeIds.map((id) => {
    const er = rows.filter((r) => r.entity_id === id);
    const l = sumMonths(actualSeries(er, (r) => A.storeLabour(r.account)), periodMonths);
    const s = sumMonths(actualSeries(er, (r) => A.storeSales(r.account)), periodMonths);
    return { label: display(nameOf[id]), l, s, pct: s ? l / s : null };
  }).filter((r) => r.l || r.s).sort((x, y) => (y.pct || 0) - (x.pct || 0));
  const storeLabour = {
    label: "Store Labour", blurb: "Store labour spend (basic pay, holiday pay, pension, employer's NI) against sales — consolidated and by store.",
    kpis: [
      { label: "Labour spend", ...V(labA, labF, false) },
      { label: "Labour % of sales", actual: salesA ? labA / salesA : null, forecast: salesF ? labF / salesF : null, isPct: true, favourHigh: false },
    ],
    table: { cols: ["Store", "Labour", "Sales", "Labour %"], pctCol: 3, rows: labourRows.map((r) => ({ cells: [r.label, r.l, r.s, r.pct] })), totalRow: { cells: ["All stores", labA, salesA, salesA ? labA / salesA : null] } },
  };

  // ---- Store EBITDA ------------------------------------------------------
  const storeEbitdaRow = (id) => {
    const er = rows.filter((r) => r.entity_id === id);
    const byMonth = {};
    for (const r of er) {
      if ((r.section === "Expenses" || r.section === "Other Expenses") && BELOW_EBITDA.test(r.account)) continue;
      const key = { "Revenue": "revenue", "Cost of Sales": "cogs", "Expenses": "expenses", "Other Income": "otherIncome", "Other Expenses": "otherExpenses" }[r.section];
      if (!key) continue;
      (byMonth[r.ym] ||= {})[key] = (byMonth[r.ym]?.[key] || 0) + r.value;
    }
    return sumMonths(Object.fromEntries(Object.entries(byMonth).map(([m, s]) => [m, ebitda(s)])), periodMonths);
  };
  const ebitdaRows = storeIds.map((id) => {
    const a = storeEbitdaRow(id);
    const fUnit = hasFc ? computeNominalPnl(forecastLines, { scope: "STORES", unit: display(nameOf[id]) }) : null;
    const f = fUnit ? sumMonths(fUnit.totals.ebitda.months, periodMonths) : null;
    return { label: display(nameOf[id]), a, f };
  }).filter((r) => r.a || r.f).sort((x, y) => y.a - x.a);
  const gEbA = ebitdaRows.reduce((t, r) => t + r.a, 0), gEbF = hasFc ? sumMonths(scopeSeries("STORES", "ebitda"), periodMonths) : null;
  const storeEbitda = {
    label: "Store EBITDA", blurb: "Operating EBITDA by store (before depreciation, interest and finance items), versus forecast.",
    kpis: [{ label: "Store EBITDA", ...V(gEbA, gEbF) }],
    table: { cols: ["Store", "Actual", "Forecast", "Variance"], rows: ebitdaRows.map((r) => ({ cells: [r.label, r.a, r.f, V(r.a, r.f)] })), totalRow: { cells: ["All stores", gEbA, gEbF, V(gEbA, gEbF)] } },
  };

  // ---- Head Office Sales (wholesale) -------------------------------------
  const wsActual = actualSeries(rows, (r) => r.scope === "head_office" && r.section === "Revenue" && A.wholesaleSales(r.account));
  const fcWS = scopeSeries("HEAD_OFFICE", "sales");
  const hoSales = {
    label: "Head Office Sales", blurb: "Total wholesale sales (Head Office revenue) versus forecast.",
    kpis: [{ label: "Wholesale sales", ...V(sumMonths(wsActual, periodMonths), hasFc ? sumMonths(fcWS, periodMonths) : null) }],
    graph: hasFc ? { label: "Wholesale sales — 12-month forecast vs YTD actual", months: fcMonths, forecast: fcMonths.map((m) => fcWS[m] || 0), actual: fcMonths.map((m) => (actualMonths.includes(m) ? (wsActual[m] || 0) : null)) } : null,
  };

  // ---- Warehouse & Logistics ---------------------------------------------
  const wlActual = actualSeries(rows, (r) => A.warehouseLogistics(r.account));
  const fcWL = fcNominalSeries(nomHO, F.warehouseLogistics);
  const wlA = sumMonths(wlActual, periodMonths), wlF = hasFc ? sumMonths(fcWL, periodMonths) : null;
  const wsA = sumMonths(wsActual, periodMonths);
  const wlNomRows = WL_NOMS.map((nom) => {
    const a = sumMonths(actualSeries(rows, (r) => r.account === nom), periodMonths);
    const f = hasFc ? sumMonths(fcNominalSeries(nomHO, (l) => l === nom), periodMonths) : null;
    return { cells: [nom.replace(/^HO: /, ""), a, f, V(a, f, false)] };
  });
  const warehouseLogistics = {
    label: "Warehouse & Logistics", blurb: "Warehouse and logistics costs (Goods In / Out, Logistics Admin, Warehouse Storage), total and as a percentage of wholesale sales, versus forecast.",
    kpis: [
      { label: "W&L cost", ...V(wlA, wlF, false) },
      { label: "% of wholesale sales", actual: wsA ? wlA / wsA : null, forecast: hasFc && sumMonths(fcWS, periodMonths) ? wlF / sumMonths(fcWS, periodMonths) : null, isPct: true, favourHigh: false },
    ],
    table: { cols: ["Nominal", "Actual", "Forecast", "Variance"], rows: wlNomRows, totalRow: { cells: ["Total W&L", wlA, wlF, V(wlA, wlF, false)] } },
  };

  // ---- Marketing (Advertising & Marketing + Printing & Stationery) -------
  const mktScopes = [{ scope: "store", label: "Stores", nomRows: nomStores }, { scope: "head_office", label: "Head Office", nomRows: nomHO }, { scope: "franchise", label: "Franchise", nomRows: nomFR }];
  const mktRows = [];
  let mA = 0, mF = 0;
  for (const s of mktScopes) for (const noun of MARKETING_NOMS) {
    const re = new RegExp(noun.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const a = sumMonths(actualSeries(rows, (r) => r.scope === s.scope && re.test(r.account)), periodMonths);
    const f = hasFc ? sumMonths(fcNominalSeries(s.nomRows, (l) => re.test(l)), periodMonths) : null;
    if (!a && !f) continue;
    mA += a; mF += f || 0;
    mktRows.push({ cells: [`${s.label} — ${noun}`, a, f, V(a, f, false)] });
  }
  const marketing = {
    label: "Marketing", blurb: "All marketing spend — Advertising & Marketing and Printing & Stationery — across stores, franchise and head office, versus forecast.",
    kpis: [{ label: "Marketing spend", ...V(mA, hasFc ? mF : null, false) }],
    table: { cols: ["Scope · Nominal", "Actual", "Forecast", "Variance"], rows: mktRows, totalRow: { cells: ["Total marketing", mA, hasFc ? mF : null, V(mA, hasFc ? mF : null, false)] } },
  };

  // ---- Franchise Income (Royalties + Marketing) --------------------------
  const royA = sumMonths(actualSeries(rows, (r) => r.section === "Revenue" && A.frRoyalty(r.account)), periodMonths);
  const mktIncA = sumMonths(actualSeries(rows, (r) => r.section === "Revenue" && A.frMarketing(r.account)), periodMonths);
  const royF = hasFc ? sumMonths(fcNominalSeries(nomFR, F.frRoyalty), periodMonths) : null;
  const mktIncF = hasFc ? sumMonths(fcNominalSeries(nomFR, F.frMarketing), periodMonths) : null;
  const franchiseIncome = {
    label: "Franchise Income", blurb: "Franchise income — royalties and marketing fees — versus forecast. (Forecast royalties map to the franchise store fee, marketing to the advertising levy.)",
    kpis: [{ label: "Franchise income", ...V(royA + mktIncA, hasFc ? (royF || 0) + (mktIncF || 0) : null) }],
    table: { cols: ["Income", "Actual", "Forecast", "Variance"], rows: [
      { cells: ["Royalties", royA, royF, V(royA, royF)] },
      { cells: ["Marketing", mktIncA, mktIncF, V(mktIncA, mktIncF)] },
    ], totalRow: { cells: ["Total franchise income", royA + mktIncA, hasFc ? (royF || 0) + (mktIncF || 0) : null, V(royA + mktIncA, hasFc ? (royF || 0) + (mktIncF || 0) : null)] } },
  };

  return {
    meta: { period, year: yr, years, months: periodMonths, forecastLoaded: hasFc },
    tabs: {
      "store-sales": storeSales,
      "store-labour": storeLabour,
      "store-ebitda": storeEbitda,
      "ho-sales": hoSales,
      "warehouse-logistics": warehouseLogistics,
      "marketing": marketing,
      "franchise-income": franchiseIncome,
    },
  };
}

export const TAB_ORDER = ["store-sales", "store-labour", "store-ebitda", "ho-sales", "warehouse-logistics", "marketing", "franchise-income"];
