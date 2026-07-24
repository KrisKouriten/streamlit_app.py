/*
 * Report Builder — pure row-shaping. No imports, no DB. Turns a loaded dataset
 * (the consolidated P&L, a balance sheet) into the common render-row shape
 * ({ months, rows, year }) that the board-pack view, the on-screen renderer and
 * the Excel/PDF export path (ma-export-rules) all already consume. Keeping the
 * transforms pure means the "shape of a report" is unit-tested independently of
 * the database. Unit-tested in tests/report-rows.test.mjs.
 *
 * Row grammar (shared with lib/pl-format.js): section | line | total | calc,
 * each with { label, values:{ym:number}, total, strong?, tone?, isPct? }.
 */

// Consolidated P&L (getJoiinPnl output) → one report tab.
export function pnlToTab(pnl) {
  const rows = [];
  for (const s of pnl.sections || []) {
    rows.push({ kind: "section", label: s.name });
    for (const r of s.rows) rows.push({ kind: "line", label: r.account, values: r.months, total: r.total });
    rows.push({ kind: "total", label: `Total ${s.name}`, values: s.total.months, total: s.total.total, strong: true });
  }
  const c = pnl.computed;
  if (c) {
    rows.push({ kind: "calc", label: "Gross profit", values: c.grossProfit.months, total: c.grossProfit.total, strong: true, tone: "gp" });
    rows.push({ kind: "calc", label: "Operating profit", values: c.operatingProfit.months, total: c.operatingProfit.total, strong: true });
    rows.push({ kind: "calc", label: "Net profit", values: c.netProfit.months, total: c.netProfit.total, strong: true, tone: "ebitda" });
  }
  const months = pnl.months || [];
  return { months, rows, year: months.length ? months[months.length - 1].slice(0, 4) : null };
}

// Balance sheet (getBalanceSheet output) → one report tab (single as-at column).
export function bsToTab(bs) {
  const m = bs.asAt;
  const rows = [];
  for (const s of bs.sections || []) {
    rows.push({ kind: "section", label: s.name });
    for (const r of s.rows) rows.push({ kind: "line", label: r.account, values: { [m]: r.value }, total: r.value });
    rows.push({ kind: "total", label: `Total ${s.name}`, values: { [m]: s.total }, total: s.total, strong: true });
  }
  return { months: m ? [m] : [], rows, year: m ? String(m).slice(0, 4) : null };
}
