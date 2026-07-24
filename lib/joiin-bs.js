import { query } from "./db";
import { balanceCheck } from "./threestatement-rules.js";

/*
 * Joiin consolidated Balance Sheet — DB read layer. Values in finance.joiin_bs
 * are as-at balances (a position at each month end). This shapes them into a
 * structured balance sheet for a month, and exposes the flat rows the
 * three-statement engine needs for two consecutive months.
 */

const tableMissing = (e) => e?.code === "42P01";

// Loaded month ends (most recent first), or [] if unloaded / table absent.
export async function bsMonths() {
  try {
    const { rows } = await query(`SELECT DISTINCT ym FROM finance.joiin_bs ORDER BY ym DESC`);
    return rows.map((r) => r.ym);
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}

// Flat as-at rows [{ section, account, value }] for one month end.
export async function bsRows(ym) {
  try {
    const { rows } = await query(
      `SELECT section, account, value FROM finance.joiin_bs WHERE ym = $1 ORDER BY section, account`, [ym]
    );
    return rows.map((r) => ({ section: r.section, account: r.account, value: Number(r.value) }));
  } catch (e) {
    if (tableMissing(e)) return [];
    throw e;
  }
}

// A structured balance sheet for one month end: sections with their lines and
// subtotals, plus the Assets = Liabilities + Equity integrity check.
export async function getBalanceSheet(ym) {
  const months = await bsMonths();
  if (!months.length) return { ready: false, loaded: false, months: [] };
  const asAt = ym && months.includes(ym) ? ym : months[0];
  const rows = await bsRows(asAt);

  const bySection = {};
  for (const r of rows) {
    (bySection[r.section] ||= []).push({ account: r.account, value: r.value });
  }
  const sections = Object.entries(bySection).map(([name, lines]) => ({
    name,
    rows: lines.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    total: lines.reduce((t, l) => t + l.value, 0),
  }));

  return { ready: true, loaded: true, asAt, months, sections, check: balanceCheck(rows) };
}
