/*
 * Management Accounts board-pack — pure reshaping + export row-building. No DB,
 * no xlsx, no React: just the arithmetic that turns a resolved board-pack tab
 * ({ months, rows, year }) into the period view the screen renders, and into
 * the 2-D array the Excel export writes. Shared by the MA page and the export
 * route so on-screen and downloaded packs are always identical. Unit-tested.
 */

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(m) {
  const [y, mo] = String(m).split("-");
  return `${MONTHS[+mo] || mo} ${String(y).slice(2)}`;
}

export const PERIOD_LABEL = {
  current: "Current month",
  trailing: "Trailing months",
  ytd: "YTD",
};

// Reshape the monthly board-pack rows for the chosen reporting period.
//  - "current"  → just the latest loaded month, no Total
//  - "trailing" → every loaded month of the year, with a summing Total
//  - "ytd"      → the year collapsed into one cumulative column
// Money rows sum across aggregate columns; % rows blank on any aggregate column
// (a summed margin is meaningless). Section/heading rows carry no values object,
// so every read is guarded.
export function applyPeriod({ months, rows, year }, period) {
  const sorted = [...months].sort();
  const sumMoney = (r, keys) => (r.isPct ? null : keys.reduce((t, m) => t + (r.values?.[m] || 0), 0));

  if (period === "current") {
    const m = sorted[sorted.length - 1];
    const cols = m ? [{ key: m, label: monthLabel(m) }] : [];
    return { cols, showTotal: false, rows: rows.map((r) => ({ ...r, total: null })) };
  }
  if (period === "ytd") {
    const K = "__ytd__";
    const cols = [{ key: K, label: `YTD ${year}` }];
    return { cols, showTotal: false, rows: rows.map((r) => ({ ...r, values: { [K]: sumMoney(r, sorted) }, total: null })) };
  }
  // trailing (default multi-month view)
  const cols = sorted.map((m) => ({ key: m, label: monthLabel(m) }));
  return { cols, showTotal: true, rows: rows.map((r) => ({ ...r, total: sumMoney(r, sorted) })) };
}

// Build the table body for one tab as an array-of-arrays (header row + data
// rows), ready for xlsx `aoa_to_sheet`. Section/heading rows collapse to a
// single label cell (matching the on-screen full-width section rows); value
// cells are raw numbers (or null for blanks) so Excel formats them. Returns the
// 0-based indices of percentage rows so the caller can apply a "0.0%" format to
// those cells while money rows get "#,##0".
export function buildTabAoa(view, label) {
  const numericCols = [...view.cols];
  const header = [label, ...numericCols.map((c) => c.label)];
  if (view.showTotal) header.push("Total");

  const aoa = [header];
  const pctRowsIdx = [];

  for (const row of view.rows) {
    if (row.kind === "section" || row.kind === "sub") {
      aoa.push([row.label]);
      continue;
    }
    const cell = (v) => (v == null ? null : v);
    const cells = [row.label, ...numericCols.map((c) => cell(row.values?.[c.key]))];
    if (view.showTotal) cells.push(cell(row.total));
    aoa.push(cells);
    if (row.isPct) pctRowsIdx.push(aoa.length - 1);
  }

  return { aoa, pctRowsIdx, colCount: header.length };
}
